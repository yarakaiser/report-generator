import { afterAll, describe, expect, it } from 'vitest';
import { Money } from '$lib/money';
import { db } from '../db';
import type { Invoice, InvoiceItem } from '../schema';
import { aggregate, computeInvoiceAggregate, type TaxRateBucket } from './aggregate';
import { fetchInvoicesWithItems } from './query';
import type { InvoiceWithItems, ReportFilter } from './types';

/**
 * Integration + unit tests for the aggregation engine. Integration cases run
 * against the :5433 test cluster; the pure unit case at the end pins the
 * rollup-exclusion and payment-adjustment logic deterministically.
 */

const FULL_RANGE: ReportFilter = { range: { from: '2025-09-22', to: '2026-07-01' } };

afterAll(async () => {
  await db.destroy();
});

function bucket(taxByRate: TaxRateBucket[], rate: number): TaxRateBucket {
  const found = taxByRate.find((b) => b.ratePercent === rate);
  if (!found) throw new Error(`No ${rate}% bucket`);
  return found;
}

describe('aggregate — full range against real rows', () => {
  it('reproduces the POS grand totals (gross/net/vat)', async () => {
    const agg = aggregate(await fetchInvoicesWithItems(FULL_RANGE));
    expect(agg.invoiceCount).toBe(109);
    expect(agg.gross.toString()).toBe('1497.10');
    expect(agg.net.toString()).toBe('1262.00');
    expect(agg.vat.toString()).toBe('235.10');
  });

  it('splits VAT by rate the way the POS does (per invoice, per rate)', async () => {
    const { taxByRate } = aggregate(await fetchInvoicesWithItems(FULL_RANGE));
    // Sorted by rate descending.
    expect(taxByRate.map((b) => b.ratePercent)).toEqual([20, 10, 0]);

    const b20 = bucket(taxByRate, 20);
    expect([b20.gross.toString(), b20.net.toString(), b20.vat.toString()]).toEqual([
      '1390.10',
      '1158.50',
      '231.60',
    ]);
    const b10 = bucket(taxByRate, 10);
    expect([b10.gross.toString(), b10.net.toString(), b10.vat.toString()]).toEqual([
      '38.50',
      '35.00',
      '3.50',
    ]);
    const b0 = bucket(taxByRate, 0);
    expect([b0.gross.toString(), b0.net.toString(), b0.vat.toString()]).toEqual([
      '68.50',
      '68.50',
      '0.00',
    ]);
  });

  it('breaks down payments on the booked-revenue basis (cash adjusted)', async () => {
    const { payments } = aggregate(await fetchInvoicesWithItems(FULL_RANGE));
    expect(payments.bar.toString()).toBe('1209.90');
    expect(payments.debit.toString()).toBe('169.90');
    expect(payments.credit.toString()).toBe('117.30');
    expect(payments.voucher.toString()).toBe('0.00');
    expect(payments.banktransfer.toString()).toBe('0.00');
  });

  it('reconciles three ways: gross = net + vat = Σtotal = Σpayments', async () => {
    const rows = await fetchInvoicesWithItems(FULL_RANGE);
    const agg = aggregate(rows);
    const sumTotals = Money.sum(rows.map((r) => Money.fromDecimalString(r.invoice.total)));
    const sumPayments = Money.sum([
      agg.payments.bar,
      agg.payments.debit,
      agg.payments.credit,
      agg.payments.voucher,
      agg.payments.banktransfer,
      agg.payments.internalconsumption,
      agg.payments.allinclusive,
      agg.payments.roomextern,
      agg.payments.invitation,
    ]);
    expect(agg.net.add(agg.vat).equals(agg.gross)).toBe(true);
    expect(agg.gross.equals(sumTotals)).toBe(true);
    expect(sumPayments.equals(sumTotals)).toBe(true);
  });
});

describe('aggregate — rollup exclusion on a collective invoice', () => {
  it('counts invoice 4408 once (21.90), not doubled (43.80)', async () => {
    const rows = await fetchInvoicesWithItems({ range: { from: '2026-01-07', to: '2026-01-07' } });
    const inv4408 = rows.find((r) => r.invoice.invoice_id === '4408');
    expect(inv4408).toBeDefined();
    const agg = computeInvoiceAggregate(inv4408!);
    expect(agg.gross.toString()).toBe('21.90');
    // Rollup lines dropped; 20 % coffee + a real 0 % bucket of Pfand deposits
    // remain. (The 10 % Senf lines are free, so that zero-gross bucket is
    // omitted — proving Pfand deposits at 0 % are kept, not confused with
    // rollups.)
    expect(agg.taxByRate.map((b) => b.ratePercent)).toEqual([20, 0]);
    expect(bucket(agg.taxByRate, 20).gross.toString()).toBe('20.40');
    expect(bucket(agg.taxByRate, 0).gross.toString()).toBe('1.50');
  });
});

describe('computeInvoiceAggregate — deterministic unit', () => {
  // Minimal partial rows: the engine only reads these fields.
  const invoice = {
    invoice_id: '1',
    total: '10.00',
    payment_bar: '12.00', // over-tendered: €2.00 change to net out
    payment_debit: '0.00',
    payment_credit: '0.00',
    payment_voucher: '0.00',
    payment_banktransfer: '0.00',
    payment_internalconsumption: '0.00',
    payment_allinclusive: '0.00',
    payment_roomextern: '0.00',
    payment_invitation: '0.00',
  } as unknown as Invoice;

  const item = (over: Partial<InvoiceItem>): InvoiceItem =>
    ({ invoice_id: '1', article_id: '100', is_zero: false, ...over }) as unknown as InvoiceItem;

  const row: InvoiceWithItems = {
    invoice,
    items: [
      // Rollup line that would double the total to 20.00 if not dropped.
      item({ article_id: '-5', article_name: 'Lieferschein LI…', article_price: '10.00', taxpercent: '0.00' }),
      item({ article_name: 'Espresso', article_price: '6.00', taxpercent: '20.00' }),
      item({ article_name: 'Wasser', article_price: '4.00', taxpercent: '10.00' }),
    ],
  };

  it('drops the rollup line and computes gross from detail only', () => {
    const agg = computeInvoiceAggregate(row);
    expect(agg.gross.toString()).toBe('10.00');
    expect(agg.taxByRate.map((b) => b.ratePercent)).toEqual([20, 10]);
  });

  it('extracts VAT per rate', () => {
    const { taxByRate } = computeInvoiceAggregate(row);
    // 6.00 @ 20% → net 5.00, vat 1.00
    expect([bucket(taxByRate, 20).net.toString(), bucket(taxByRate, 20).vat.toString()]).toEqual([
      '5.00',
      '1.00',
    ]);
    // 4.00 @ 10% → net 3.64, vat 0.36
    expect([bucket(taxByRate, 10).net.toString(), bucket(taxByRate, 10).vat.toString()]).toEqual([
      '3.64',
      '0.36',
    ]);
  });

  it('nets over-tendered cash change out of payments.bar', () => {
    const { payments } = computeInvoiceAggregate(row);
    expect(payments.bar.toString()).toBe('10.00'); // 12.00 tendered − 2.00 change
  });
});
