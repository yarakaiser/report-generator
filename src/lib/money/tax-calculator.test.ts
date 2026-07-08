import { describe, it, expect } from 'vitest';
import { calculateLineTotals, calculateInvoiceTotals } from './tax-calculator.js';

describe('calculateLineTotals', () => {
  it('calculates 20% tax correctly', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 1200,
      taxRatePercent: 20,
    });

    expect(result.totalGrossCents).toBe(1200);
    expect(result.net.toCents()).toBe(1000);
    expect(result.vat.toCents()).toBe(200);
  });

  it('calculates 19% tax (German rate)', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 1190,
      taxRatePercent: 19,
    });

    expect(result.totalGrossCents).toBe(1190);
    expect(result.net.toCents()).toBe(1000);
    expect(result.vat.toCents()).toBe(190);
  });

  it('calculates 7% tax (German reduced)', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 1070,
      taxRatePercent: 7,
    });

    expect(result.totalGrossCents).toBe(1070);
    expect(result.net.toCents()).toBe(1000);
    expect(result.vat.toCents()).toBe(70);
  });

  it('handles 0% tax', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 1000,
      taxRatePercent: 0,
    });

    expect(result.net.toCents()).toBe(1000);
    expect(result.vat.toCents()).toBe(0);
  });

  it('multiplies by quantity', () => {
    const result = calculateLineTotals({
      quantity: 3,
      unitPriceCents: 400,
      taxRatePercent: 20,
    });

    expect(result.totalGrossCents).toBe(1200);
  });

  it('applies discount percentage', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 1200,
      taxRatePercent: 20,
      discountPercent: 50,
    });

    expect(result.totalGrossCents).toBe(600);
    expect(result.net.toCents()).toBe(500);
    expect(result.vat.toCents()).toBe(100);
  });

  it('maintains gross = net + vat invariant', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 999,
      taxRatePercent: 20,
    });

    expect(result.net.toCents() + result.vat.toCents()).toBe(result.gross.toCents());
  });

  it('handles fractional tax rates', () => {
    const result = calculateLineTotals({
      quantity: 1,
      unitPriceCents: 1125,
      taxRatePercent: 12.5,
    });

    expect(result.totalGrossCents).toBe(1125);
    expect(result.net.toCents()).toBe(1000);
    expect(result.vat.toCents()).toBe(125);
  });
});

describe('calculateInvoiceTotals', () => {
  it('aggregates single tax rate', () => {
    const items = [
      { quantity: 2, unitPriceCents: 600, taxRatePercent: 20 },
      { quantity: 1, unitPriceCents: 300, taxRatePercent: 20 },
    ];

    const result = calculateInvoiceTotals(items);

    expect(result.totalGrossCents).toBe(1500);
    expect(result.taxBuckets.length).toBe(1);
    expect(result.taxBuckets[0]?.ratePercent).toBe(20);
  });

  it('aggregates multiple tax rates', () => {
    const items = [
      { quantity: 1, unitPriceCents: 1200, taxRatePercent: 20 },
      { quantity: 1, unitPriceCents: 1100, taxRatePercent: 10 },
      { quantity: 1, unitPriceCents: 500, taxRatePercent: 0 },
    ];

    const result = calculateInvoiceTotals(items);

    expect(result.totalGrossCents).toBe(2800);
    expect(result.taxBuckets.length).toBe(3);
  });

  it('handles mixed country tax rates', () => {
    const items = [
      { quantity: 1, unitPriceCents: 1190, taxRatePercent: 19 },
      { quantity: 1, unitPriceCents: 1070, taxRatePercent: 7 },
    ];

    const result = calculateInvoiceTotals(items);

    expect(result.totalGrossCents).toBe(2260);
    expect(result.taxBuckets.length).toBe(2);

    const vat19 = result.taxBuckets.find((b) => b.ratePercent === 19);
    const vat7 = result.taxBuckets.find((b) => b.ratePercent === 7);

    expect(vat19?.netCents).toBe(1000);
    expect(vat7?.netCents).toBe(1000);
  });

  it('handles empty items array', () => {
    const result = calculateInvoiceTotals([]);

    expect(result.totalGrossCents).toBe(0);
    expect(result.totalNetCents).toBe(0);
    expect(result.totalVatCents).toBe(0);
    expect(result.taxBuckets.length).toBe(0);
  });

  it('maintains gross = net + vat invariant across all buckets', () => {
    const items = [
      { quantity: 7, unitPriceCents: 333, taxRatePercent: 20 },
      { quantity: 3, unitPriceCents: 777, taxRatePercent: 13 },
      { quantity: 5, unitPriceCents: 199, taxRatePercent: 10 },
      { quantity: 2, unitPriceCents: 499, taxRatePercent: 0 },
    ];

    const result = calculateInvoiceTotals(items);

    for (const bucket of result.taxBuckets) {
      expect(bucket.grossCents).toBe(bucket.netCents + bucket.vatCents);
    }
    expect(result.totalGrossCents).toBe(result.totalNetCents + result.totalVatCents);
  });
});
