import { Money, type TaxBreakdown } from './money.js';

/**
 * Input for line item tax calculation.
 */
export interface LineItemInput {
  /** Number of items (positive integer) */
  quantity: number;
  /** Unit price in cents (integer) */
  unitPriceCents: number;
  /** Tax rate percentage (e.g., 20 for 20%) */
  taxRatePercent: number;
  /** Optional discount percentage (0-100) */
  discountPercent?: number;
}

/**
 * Result of line item calculation including tax breakdown.
 */
export interface LineTotals extends TaxBreakdown {
  /** Total gross amount in cents */
  totalGrossCents: number;
}

/**
 * Tax bucket for grouping by tax rate in invoice totals.
 */
export interface TaxBucket {
  /** Tax rate percentage */
  ratePercent: number;
  /** Total gross for this rate in cents */
  grossCents: number;
  /** Total net for this rate in cents */
  netCents: number;
  /** Total VAT for this rate in cents */
  vatCents: number;
}

/**
 * Complete invoice totals with tax breakdown by rate.
 */
export interface InvoiceTotals {
  /** Grand total including VAT in cents */
  totalGrossCents: number;
  /** Grand total excluding VAT in cents */
  totalNetCents: number;
  /** Total VAT amount in cents */
  totalVatCents: number;
  /** Tax breakdown grouped by rate */
  taxBuckets: TaxBucket[];
}

/**
 * Calculates totals for a single line item.
 * Handles quantity multiplication, discount, and tax extraction.
 *
 * @param item - Line item input with quantity, price, tax rate
 * @returns Calculated totals with Money objects and cents values
 */
export function calculateLineTotals(item: LineItemInput): LineTotals {
  const lineTotal = Money.fromCents(item.unitPriceCents).multiply(item.quantity).toCents();

  let grossCents = lineTotal;
  if (item.discountPercent && item.discountPercent > 0) {
    const discountAmount = Money.fromCents(lineTotal)
      .multiply(item.discountPercent)
      .divide(100)
      .toCents();
    grossCents = Money.fromCents(lineTotal).subtract(Money.fromCents(discountAmount)).toCents();
  }

  const gross = Money.fromCents(grossCents);
  const taxBreakdown = gross.extractTaxGeneric(item.taxRatePercent);

  return {
    ...taxBreakdown,
    totalGrossCents: grossCents,
  };
}

/**
 * Calculates invoice totals from multiple line items.
 * Groups items by tax rate and calculates per-rate buckets plus grand totals.
 *
 * @param items - Array of line item inputs
 * @returns Tax buckets per rate and grand totals
 */
export function calculateInvoiceTotals(items: LineItemInput[]): InvoiceTotals {
  const buckets = new Map<number, { gross: number; net: number; vat: number }>();
  const addCents = (a: number, b: number): number =>
    Money.fromCents(a).add(Money.fromCents(b)).toCents();

  for (const item of items) {
    const lineTotals = calculateLineTotals(item);

    if (!buckets.has(item.taxRatePercent)) {
      buckets.set(item.taxRatePercent, { gross: 0, net: 0, vat: 0 });
    }

    const bucket = buckets.get(item.taxRatePercent)!;
    bucket.gross = addCents(bucket.gross, lineTotals.gross.toCents());
    bucket.net = addCents(bucket.net, lineTotals.net.toCents());
    bucket.vat = addCents(bucket.vat, lineTotals.vat.toCents());
  }

  let totalGross = 0;
  let totalNet = 0;
  let totalVat = 0;

  const taxBuckets: TaxBucket[] = [];

  for (const [rate, bucket] of buckets) {
    totalGross = addCents(totalGross, bucket.gross);
    totalNet = addCents(totalNet, bucket.net);
    totalVat = addCents(totalVat, bucket.vat);

    if (bucket.gross !== 0) {
      taxBuckets.push({
        ratePercent: rate,
        grossCents: bucket.gross,
        netCents: bucket.net,
        vatCents: bucket.vat,
      });
    }
  }

  return {
    totalGrossCents: totalGross,
    totalNetCents: totalNet,
    totalVatCents: totalVat,
    taxBuckets,
  };
}
