import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money — construction & parsing', () => {
  it('parses a dot decimal string', () => {
    expect(Money.fromDecimalString('8.40').toString()).toBe('8.40');
  });

  it('parses a comma decimal string (de-AT input)', () => {
    expect(Money.fromDecimalString('8,40').toString()).toBe('8.40');
  });

  it('quantizes to 2 decimal places on construction (half-up)', () => {
    expect(Money.fromDecimalString('8.405').toString()).toBe('8.41');
    expect(Money.fromDecimalString('8.404').toString()).toBe('8.40');
  });

  it('builds from a Decimal', () => {
    expect(Money.fromDecimal(new Decimal('1497.1')).toString()).toBe('1497.10');
  });

  it('zero is 0.00', () => {
    expect(Money.zero().toString()).toBe('0.00');
    expect(Money.zero().isZero()).toBe(true);
  });

  it('exposes the underlying Decimal', () => {
    expect(Money.fromDecimalString('8.40').toDecimal().equals(new Decimal('8.4'))).toBe(true);
  });
});

describe('Money — arithmetic', () => {
  it('adds and subtracts', () => {
    const a = Money.fromDecimalString('4.60');
    const b = Money.fromDecimalString('5.00');
    expect(a.add(b).toString()).toBe('9.60');
    expect(b.subtract(a).toString()).toBe('0.40');
  });

  it('multiplies by a quantity', () => {
    expect(Money.fromDecimalString('2.70').multiply(3).toString()).toBe('8.10');
    expect(Money.fromDecimalString('2.70').multiply('2.5').toString()).toBe('6.75');
  });

  it('divides, rounding half-up to the currency scale', () => {
    expect(Money.fromDecimalString('10.00').divide(3).toString()).toBe('3.33');
  });

  it('throws on divide by zero', () => {
    expect(() => Money.fromDecimalString('1.00').divide(0)).toThrow(/divide by zero/);
  });

  it('negates and takes absolute value', () => {
    expect(Money.fromDecimalString('4.60').negate().toString()).toBe('-4.60');
    expect(Money.fromDecimalString('-4.60').abs().toString()).toBe('4.60');
  });

  it('sums an array (zero for empty)', () => {
    const sum = Money.sum(['4.60', '5.00', '2.70'].map((v) => Money.fromDecimalString(v)));
    expect(sum.toString()).toBe('12.30');
    expect(Money.sum([]).toString()).toBe('0.00');
  });
});

describe('Money — predicates & comparison', () => {
  it('reports sign', () => {
    expect(Money.fromDecimalString('4.60').isPositive()).toBe(true);
    expect(Money.fromDecimalString('-4.60').isNegative()).toBe(true);
    expect(Money.zero().isPositive()).toBe(false);
  });

  it('compares amounts', () => {
    const a = Money.fromDecimalString('4.60');
    const b = Money.fromDecimalString('5.00');
    expect(a.lessThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(true);
    expect(a.greaterThanOrEqual(a)).toBe(true);
    expect(a.lessThanOrEqual(a)).toBe(true);
    expect(a.equals(Money.fromDecimalString('4.60'))).toBe(true);
  });
});

describe('Money — tax extraction (gross → net + vat)', () => {
  it('extracts 20% VAT from a gross amount', () => {
    const { gross, net, vat, rate } = Money.fromDecimalString('8.10').extractTax(20);
    expect(gross.toString()).toBe('8.10');
    expect(net.toString()).toBe('6.75');
    expect(vat.toString()).toBe('1.35');
    expect(rate).toBe(20);
  });

  it('extracts 10% VAT', () => {
    const { net, vat } = Money.fromDecimalString('1.10').extractTax(10);
    expect(net.toString()).toBe('1.00');
    expect(vat.toString()).toBe('0.10');
  });

  it('keeps gross = net + vat under rounding', () => {
    const { gross, net, vat } = Money.fromDecimalString('1.00').extractTax(20);
    expect(net.toString()).toBe('0.83');
    expect(vat.toString()).toBe('0.17');
    expect(net.add(vat).equals(gross)).toBe(true);
  });

  it('treats 0% as all-net, no VAT', () => {
    const { net, vat } = Money.fromDecimalString('5.00').extractTax(0);
    expect(net.toString()).toBe('5.00');
    expect(vat.toString()).toBe('0.00');
  });

  it('throws on a negative rate', () => {
    expect(() => Money.fromDecimalString('5.00').extractTax(-1)).toThrow(/negative/);
  });
});

describe('Money — tax addition (net → gross + vat)', () => {
  it('adds 20% VAT to a net amount', () => {
    const { gross, net, vat } = Money.fromDecimalString('6.75').addTax(20);
    expect(net.toString()).toBe('6.75');
    expect(gross.toString()).toBe('8.10');
    expect(vat.toString()).toBe('1.35');
  });
});

describe('Money — currency safety', () => {
  it('throws when summing mixed currencies', () => {
    const eur = Money.fromDecimalString('1.00', 'EUR');
    // Force a foreign currency past the type system to prove the runtime guard.
    const usd = Money.fromDecimalString('1.00', 'USD' as 'EUR');
    expect(() => Money.sum([eur, usd])).toThrow(/different currencies/);
  });
});

describe('Money — formatting', () => {
  it('formats as de-AT currency and number', () => {
    const m = Money.fromDecimalString('1497.10');
    // de-AT uses a comma decimal separator. The thousands grouping character
    // varies by ICU (dot for currency, space for plain number here), so strip
    // grouping separators and the symbol and assert the significant value.
    const stripGrouping = (s: string) => s.replace(/[\s.€]/g, '');
    expect(m.format()).toContain('€');
    expect(stripGrouping(m.format())).toBe('1497,10');
    expect(stripGrouping(m.formatNumber())).toBe('1497,10');
    expect(m.toString()).toBe('1497.10');
  });
});
