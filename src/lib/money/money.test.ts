import { describe, it, expect } from 'vitest';
import { Money, type AustrianTaxRate } from './money.js';

describe('Money', () => {
  describe('creation', () => {
    it('creates from integer cents', () => {
      const m = Money.fromCents(1050);
      expect(m.toCents()).toBe(1050);
      expect(m.getCurrency()).toBe('EUR');
    });

    it('creates from decimal string with dot', () => {
      const m = Money.fromDecimalString('10.50');
      expect(m.toCents()).toBe(1050);
    });

    it('creates from decimal string with comma (German format)', () => {
      const m = Money.fromDecimalString('10,50');
      expect(m.toCents()).toBe(1050);
    });

    it('rejects non-integer cents', () => {
      expect(() => Money.fromCents(10.5)).toThrow('integer');
    });

    it('creates zero money', () => {
      const m = Money.zero();
      expect(m.toCents()).toBe(0);
      expect(m.isZero()).toBe(true);
    });
  });

  describe('formatting', () => {
    it('formats for Austrian locale', () => {
      const m = Money.fromCents(1050);
      const formatted = m.format('de-AT');
      expect(formatted).toContain('10,50');
      expect(formatted).toContain('€');
    });

    it('formats number only', () => {
      const m = Money.fromCents(1050);
      expect(m.formatNumber('de-AT')).toBe('10,50');
    });

    it('converts to string', () => {
      const m = Money.fromCents(1050);
      expect(m.toString()).toContain('EUR');
    });
  });

  describe('arithmetic', () => {
    it('adds two amounts', () => {
      const a = Money.fromCents(1000);
      const b = Money.fromCents(250);
      expect(a.add(b).toCents()).toBe(1250);
    });

    it('subtracts two amounts', () => {
      const a = Money.fromCents(1000);
      const b = Money.fromCents(250);
      expect(a.subtract(b).toCents()).toBe(750);
    });

    it('multiplies by factor', () => {
      const m = Money.fromCents(1000);
      expect(m.multiply(2.5).toCents()).toBe(2500);
    });

    it('divides by divisor', () => {
      const m = Money.fromCents(1000);
      expect(m.divide(4).toCents()).toBe(250);
    });

    it('negates amount', () => {
      const m = Money.fromCents(1000);
      expect(m.negate().toCents()).toBe(-1000);
    });

    it('returns absolute value', () => {
      const m = Money.fromCents(-1000);
      expect(m.abs().toCents()).toBe(1000);
    });

    it('rejects operations between different currencies', () => {
      const eur = Money.fromCents(1000, 'EUR');
      const eur2 = Money.fromCents(500, 'EUR');
      expect(() => eur.add(eur2)).not.toThrow();
    });

    it('rejects division by zero', () => {
      const m = Money.fromCents(1000);
      expect(() => m.divide(0)).toThrow('zero');
    });
  });

  describe('rounding (ROUND_HALF_UP)', () => {
    it('rounds 0.5 up', () => {
      const m = Money.fromDecimalString('10.005');
      expect(m.toCents()).toBe(1001);
    });

    it('rounds 0.4 down', () => {
      const m = Money.fromDecimalString('10.004');
      expect(m.toCents()).toBe(1000);
    });

    it('handles 1.005 correctly', () => {
      const m = Money.fromDecimalString('1.005');
      expect(m.toCents()).toBe(101);
    });

    it('rounds multiplication result', () => {
      const m = Money.fromCents(333);
      expect(m.multiply(3).toCents()).toBe(999);
    });
  });

  describe('comparison', () => {
    it('checks equality', () => {
      const a = Money.fromCents(1000);
      const b = Money.fromCents(1000);
      const c = Money.fromCents(500);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });

    it('compares greater than', () => {
      const a = Money.fromCents(1000);
      const b = Money.fromCents(500);
      expect(a.greaterThan(b)).toBe(true);
      expect(b.greaterThan(a)).toBe(false);
    });

    it('compares less than', () => {
      const a = Money.fromCents(500);
      const b = Money.fromCents(1000);
      expect(a.lessThan(b)).toBe(true);
      expect(b.lessThan(a)).toBe(false);
    });

    it('checks positive/negative/zero', () => {
      expect(Money.fromCents(100).isPositive()).toBe(true);
      expect(Money.fromCents(-100).isNegative()).toBe(true);
      expect(Money.fromCents(0).isZero()).toBe(true);
    });
  });

  describe('Austrian tax extraction (Gross → Net)', () => {
    it('extracts 20% tax correctly', () => {
      const gross = Money.fromCents(12000);
      const { net, vat, rate } = gross.extractTax(20);

      expect(rate).toBe(20);
      expect(net.toCents()).toBe(10000);
      expect(vat.toCents()).toBe(2000);
      expect(net.add(vat).toCents()).toBe(gross.toCents());
    });

    it('extracts 13% tax correctly', () => {
      const gross = Money.fromCents(11300);
      const { net, vat } = gross.extractTax(13);

      expect(net.toCents()).toBe(10000);
      expect(vat.toCents()).toBe(1300);
    });

    it('extracts 10% tax correctly', () => {
      const gross = Money.fromCents(11000);
      const { net, vat } = gross.extractTax(10);

      expect(net.toCents()).toBe(10000);
      expect(vat.toCents()).toBe(1000);
    });

    it('handles 0% tax rate', () => {
      const gross = Money.fromCents(10000);
      const { net, vat } = gross.extractTax(0);

      expect(net.toCents()).toBe(10000);
      expect(vat.toCents()).toBe(0);
    });

    it('handles rounding edge case', () => {
      const gross = Money.fromCents(999);
      const { net, vat, gross: g } = gross.extractTax(20);

      expect(net.add(vat).toCents()).toBe(g.toCents());
    });

    it('rejects invalid tax rates', () => {
      const m = Money.fromCents(1000);
      expect(() => m.extractTax(19 as AustrianTaxRate)).toThrow('Invalid');
    });
  });

  describe('Austrian tax addition (Net → Gross)', () => {
    it('adds 20% tax correctly', () => {
      const net = Money.fromCents(10000);
      const { gross, vat, rate } = net.addTax(20);

      expect(rate).toBe(20);
      expect(gross.toCents()).toBe(12000);
      expect(vat.toCents()).toBe(2000);
    });

    it('adds 13% tax correctly', () => {
      const net = Money.fromCents(10000);
      const { gross, vat } = net.addTax(13);

      expect(gross.toCents()).toBe(11300);
      expect(vat.toCents()).toBe(1300);
    });

    it('adds 10% tax correctly', () => {
      const net = Money.fromCents(10000);
      const { gross, vat } = net.addTax(10);

      expect(gross.toCents()).toBe(11000);
      expect(vat.toCents()).toBe(1000);
    });

    it('handles 0% tax rate', () => {
      const net = Money.fromCents(10000);
      const { gross, vat } = net.addTax(0);

      expect(gross.toCents()).toBe(10000);
      expect(vat.toCents()).toBe(0);
    });
  });

  describe('sum', () => {
    it('sums array of money', () => {
      const amounts = [Money.fromCents(100), Money.fromCents(200), Money.fromCents(300)];
      expect(Money.sum(amounts).toCents()).toBe(600);
    });

    it('returns zero for empty array', () => {
      expect(Money.sum([]).toCents()).toBe(0);
    });
  });

  describe('allocation', () => {
    it('allocates by ratios', () => {
      const m = Money.fromCents(100);
      const [a, b, c] = m.allocate([1, 1, 1]);

      expect(a.toCents() + b.toCents() + c.toCents()).toBe(100);
    });

    it('handles uneven splits with remainder', () => {
      const m = Money.fromCents(100);
      const [a, b, c] = m.allocate([1, 1, 1]);

      const total = a.toCents() + b.toCents() + c.toCents();
      expect(total).toBe(100);
    });

    it('rejects empty ratios', () => {
      const m = Money.fromCents(100);
      expect(() => m.allocate([])).toThrow();
    });
  });

  describe('serialization', () => {
    it('converts to JSON', () => {
      const m = Money.fromCents(1050);
      const json = m.toJSON();

      expect(json).toEqual({ cents: 1050, currency: 'EUR' });
    });

    it('creates from JSON', () => {
      const m = Money.fromJSON({ cents: 1050, currency: 'EUR' });

      expect(m.toCents()).toBe(1050);
      expect(m.getCurrency()).toBe('EUR');
    });
  });

  describe('edge cases', () => {
    it('handles large amounts (10 million euros)', () => {
      const m = Money.fromCents(1_000_000_000);
      expect(m.toCents()).toBe(1_000_000_000);
      expect(m.multiply(2).toCents()).toBe(2_000_000_000);
    });

    it('handles very large amounts near safe integer limit', () => {
      const maxSafeCents = Math.floor(Number.MAX_SAFE_INTEGER / 100);
      const m = Money.fromCents(maxSafeCents);
      expect(m.toCents()).toBe(maxSafeCents);
    });

    it('handles negative amounts', () => {
      const m = Money.fromCents(-1000);
      expect(m.isNegative()).toBe(true);
      expect(m.abs().toCents()).toBe(1000);
      expect(m.add(Money.fromCents(500)).toCents()).toBe(-500);
    });

    it('handles negative amount tax extraction', () => {
      const refund = Money.fromCents(-1200);
      const { net, vat } = refund.extractTax(20);
      expect(net.toCents()).toBe(-1000);
      expect(vat.toCents()).toBe(-200);
    });

    it('handles very small decimal strings', () => {
      const m = Money.fromDecimalString('0.01');
      expect(m.toCents()).toBe(1);
    });

    it('handles fractional cents rounding correctly', () => {
      const m = Money.fromDecimalString('0.999');
      expect(m.toCents()).toBe(100);
    });

    it('handles division with very small divisor', () => {
      const m = Money.fromCents(100);
      expect(m.divide(0.01).toCents()).toBe(10000);
    });

    it('handles multiplication by very small factor', () => {
      const m = Money.fromCents(10000);
      expect(m.multiply(0.001).toCents()).toBe(10);
    });

    it('allocation handles prime number split', () => {
      const m = Money.fromCents(100);
      const parts = m.allocate([1, 1, 1, 1, 1, 1, 1]);
      const total = parts.reduce((sum, p) => sum + p.toCents(), 0);
      expect(total).toBe(100);
    });

    it('allocation handles weighted split with remainder', () => {
      const m = Money.fromCents(100);
      const [a, b] = m.allocate([1, 2]);
      expect(a.toCents() + b.toCents()).toBe(100);
      expect(b.toCents()).toBeGreaterThan(a.toCents());
    });

    it('handles zero in allocation ratios', () => {
      const m = Money.fromCents(100);
      expect(() => m.allocate([0, 0, 0])).toThrow();
    });

    it('sum handles single element', () => {
      const amounts = [Money.fromCents(100)];
      expect(Money.sum(amounts).toCents()).toBe(100);
    });

    it('greaterThanOrEqual handles equality', () => {
      const a = Money.fromCents(100);
      const b = Money.fromCents(100);
      expect(a.greaterThanOrEqual(b)).toBe(true);
      expect(a.lessThanOrEqual(b)).toBe(true);
    });

    it('handles string multiplication factor', () => {
      const m = Money.fromCents(1000);
      expect(m.multiply('2.5').toCents()).toBe(2500);
    });

    it('handles string division factor', () => {
      const m = Money.fromCents(1000);
      expect(m.divide('2.5').toCents()).toBe(400);
    });

    it('toDecimal returns correct value', () => {
      const m = Money.fromCents(1234);
      expect(m.toDecimal().toNumber()).toBe(12.34);
    });
  });
});
