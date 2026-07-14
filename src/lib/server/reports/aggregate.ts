import { Money } from '$lib/money';
import { log } from '../log';
import type { InvoiceWithItems } from './types';

/**
 * Synthetic "Lieferschein …" rollup line marker. Collective invoices assembled
 * from delivery notes carry a per-delivery-note subtotal header line with
 * `article_id = -5` (0 % tax, name `"Lieferschein …"`) that duplicates the sum
 * of the detail lines beneath it. These lines are presentational only and MUST
 * be dropped before aggregating, or every such invoice double-counts. The
 * detail lines alone reconcile exactly to the invoice `total`. (Note: the
 * negative-id space is reused — e.g. deposits `Pfand` are `article_id = -8` and
 * are genuine detail lines to keep — so the discriminator is exactly `-5`.)
 */
export const ROLLUP_ARTICLE_ID = '-5';

/** Aggregated gross/net/vat for one VAT rate. */
export interface TaxRateBucket {
  /** Tax rate percentage, e.g. 20, 10, 0. */
  ratePercent: number;
  /** Gross (incl. VAT). */
  gross: Money;
  /** Net (excl. VAT). */
  net: Money;
  /** VAT amount. */
  vat: Money;
}

/** Payment totals per method (see the `payment_*` columns on `pos.invoices`). */
export interface PaymentBreakdown {
  /** Cash — adjusted down by over-tendered change (booked-revenue basis). */
  bar: Money;
  debit: Money;
  credit: Money;
  voucher: Money;
  banktransfer: Money;
  internalconsumption: Money;
  allinclusive: Money;
  roomextern: Money;
  invitation: Money;
}

/** The computed breakdown for a set of invoices. */
export interface Aggregate {
  /** Number of invoices contributing to this aggregate. */
  invoiceCount: number;
  /** Grand total incl. VAT — the sum of invoice `total` (brutto). */
  gross: Money;
  /** Grand total excl. VAT. */
  net: Money;
  /** Total VAT. */
  vat: Money;
  /** Per-rate breakdown, sorted by rate descending. */
  taxByRate: TaxRateBucket[];
  /** Payment-method breakdown (cash adjusted for change). */
  payments: PaymentBreakdown;
}

/** Payment methods in a stable order; maps method → `payment_<method>` column. */
const PAYMENT_METHODS = [
  'bar',
  'debit',
  'credit',
  'voucher',
  'banktransfer',
  'internalconsumption',
  'allinclusive',
  'roomextern',
  'invitation',
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function zeroPayments(): PaymentBreakdown {
  return {
    bar: Money.zero(),
    debit: Money.zero(),
    credit: Money.zero(),
    voucher: Money.zero(),
    banktransfer: Money.zero(),
    internalconsumption: Money.zero(),
    allinclusive: Money.zero(),
    roomextern: Money.zero(),
    invitation: Money.zero(),
  };
}

/**
 * Reads the nine payment columns of an invoice and applies the booked-revenue
 * adjustment: the amount by which recorded payments exceed the invoice `total`
 * is over-tendered cash change (always returned in cash), so it is subtracted
 * from `bar`. The result reconciles each invoice's payments to its `total`.
 * `amount_retour` is not used — it is unreliable in the legacy data.
 */
function invoicePayments(invoice: InvoiceWithItems['invoice']): PaymentBreakdown {
  const total = Money.fromDecimalString(invoice.total);
  const payments: PaymentBreakdown = {
    bar: Money.fromDecimalString(invoice.payment_bar),
    debit: Money.fromDecimalString(invoice.payment_debit),
    credit: Money.fromDecimalString(invoice.payment_credit),
    voucher: Money.fromDecimalString(invoice.payment_voucher),
    banktransfer: Money.fromDecimalString(invoice.payment_banktransfer),
    internalconsumption: Money.fromDecimalString(invoice.payment_internalconsumption),
    allinclusive: Money.fromDecimalString(invoice.payment_allinclusive),
    roomextern: Money.fromDecimalString(invoice.payment_roomextern),
    invitation: Money.fromDecimalString(invoice.payment_invitation),
  };

  const paySum = Money.sum(PAYMENT_METHODS.map((m) => payments[m]));
  const overpayment = paySum.subtract(total);
  payments.bar = payments.bar.subtract(overpayment);
  return payments;
}

/**
 * Computes the aggregate for a single invoice. VAT is extracted **per invoice,
 * per rate** — line items (excluding rollup lines) are grouped by `taxpercent`,
 * summed, then split once via {@link Money.extractTax}. This reproduces the
 * POS's own `vat` / `nettoprice` figures exactly.
 */
export function computeInvoiceAggregate({ invoice, items }: InvoiceWithItems): Aggregate {
  const grossByRate = new Map<number, Money>();
  for (const item of items) {
    if (item.article_id === ROLLUP_ARTICLE_ID) {
      continue;
    }
    const rate = Number(item.taxpercent);
    const price = Money.fromDecimalString(item.article_price);
    grossByRate.set(rate, (grossByRate.get(rate) ?? Money.zero()).add(price));
  }

  const taxByRate: TaxRateBucket[] = [];
  let net = Money.zero();
  let vat = Money.zero();
  for (const [ratePercent, rateGross] of grossByRate) {
    const breakdown = rateGross.extractTax(ratePercent);
    net = net.add(breakdown.net);
    vat = vat.add(breakdown.vat);
    // Skip rate buckets with zero gross (e.g. only free items at that rate) —
    // they carry no turnover and would just clutter the VAT breakdown.
    if (!rateGross.isZero()) {
      taxByRate.push({ ratePercent, gross: rateGross, net: breakdown.net, vat: breakdown.vat });
    }
  }
  taxByRate.sort((a, b) => b.ratePercent - a.ratePercent);

  return {
    // Brutto is the authoritative invoice total (price), not the sum of line
    // gross — robust when items don't fully reconcile. For valid data the two
    // are equal, so gross = net + vat still holds.
    invoiceCount: 1,
    gross: Money.fromDecimalString(invoice.total),
    net,
    vat,
    taxByRate,
    payments: invoicePayments(invoice),
  };
}

/**
 * Merges aggregates by summing all amounts (Money addition is exact at the
 * currency scale, so merging per-invoice aggregates equals aggregating the
 * whole set). Tax buckets are merged by rate. This is the primitive the
 * recursive grouping in the next step builds on.
 */
export function mergeAggregates(parts: Aggregate[]): Aggregate {
  let invoiceCount = 0;
  let gross = Money.zero();
  let net = Money.zero();
  let vat = Money.zero();
  const byRate = new Map<number, TaxRateBucket>();
  const payments = zeroPayments();

  for (const part of parts) {
    invoiceCount += part.invoiceCount;
    gross = gross.add(part.gross);
    net = net.add(part.net);
    vat = vat.add(part.vat);

    for (const bucket of part.taxByRate) {
      const current = byRate.get(bucket.ratePercent);
      if (current) {
        current.gross = current.gross.add(bucket.gross);
        current.net = current.net.add(bucket.net);
        current.vat = current.vat.add(bucket.vat);
      } else {
        byRate.set(bucket.ratePercent, { ...bucket });
      }
    }

    for (const method of PAYMENT_METHODS) {
      payments[method] = payments[method].add(part.payments[method]);
    }
  }

  const taxByRate = [...byRate.values()].sort((a, b) => b.ratePercent - a.ratePercent);
  return { invoiceCount, gross, net, vat, taxByRate, payments };
}

/**
 * Aggregates a set of invoices-with-items into totals, per-rate VAT buckets, and
 * the payment-method breakdown — all through {@link Money}.
 */
export function aggregate(rows: InvoiceWithItems[]): Aggregate {
  log.debug({ invoiceCount: rows.length }, 'Aggregating invoices');
  const result = mergeAggregates(rows.map(computeInvoiceAggregate));
  log.debug(
    {
      invoiceCount: result.invoiceCount,
      gross: result.gross.toString(),
      net: result.net.toString(),
      vat: result.vat.toString(),
      rates: result.taxByRate.map((b) => b.ratePercent),
    },
    'Aggregated invoices',
  );
  return result;
}
