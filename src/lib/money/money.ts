import { Decimal } from 'decimal.js';

// Financial precision: generous guard digits with half-up rounding, the
// Austrian statutory rounding mode. Currency amounts are represented as decimals
// in the main unit (euros) — matching the legacy POS `numeric(10,2)` columns —
// never as integer cents and never as raw JS `number`.
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
});

/** Supported currency codes. Only EUR for the Austrian POS. */
export type Currency = 'EUR';

/**
 * Austrian statutory VAT rates (documentation type):
 * - 20 % standard (Normalsteuersatz)
 * - 13 % accommodation (Ermäßigter Steuersatz)
 * - 10 % food / books (Ermäßigter Steuersatz)
 * - 0 % exempt (Steuerbefreit)
 *
 * Tax methods accept any non-negative rate, since the DB `taxpercent` is the
 * source of truth and could carry other values.
 */
export type AustrianTaxRate = 20 | 13 | 10 | 0;

/** Result of a tax split. Invariant: `gross = net + vat`. */
export interface TaxBreakdown {
  /** Amount including VAT. */
  gross: Money;
  /** Amount excluding VAT. */
  net: Money;
  /** VAT amount. */
  vat: Money;
  /** Tax rate percentage applied. */
  rate: number;
}

/** Currency scale — `numeric(10,2)` → 2 decimal places. */
const SCALE = 2;

/** Rounds a decimal to the currency scale (half-up). */
function toMoneyScale(value: Decimal): Decimal {
  return value.toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP);
}

/**
 * Immutable currency value object backed by `decimal.js`.
 *
 * Stores the amount as a `Decimal` in the main currency unit (euros), quantized
 * to 2 decimal places on every operation. All monetary math in the tool goes
 * through this class — never raw JS `number` arithmetic (no `x / 100`,
 * `x * 100`, `.toFixed(2)` on currency, or `Intl.NumberFormat(currency)` on a
 * raw number).
 *
 * @example
 * ```typescript
 * const total = Money.fromDecimalString('8,40');   // parses comma or dot
 * const { net, vat } = total.extractTax(20);        // gross → net + vat
 * total.format();       // "€ 8,40"
 * total.toString();     // "8.40"
 * ```
 */
export class Money {
  private readonly amount: Decimal;
  private readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount;
    this.currency = currency;
  }

  /**
   * Creates a Money from a decimal string (DB value or user input). Accepts both
   * comma and dot as the decimal separator.
   */
  static fromDecimalString(value: string, currency: Currency = 'EUR'): Money {
    const normalized = value.replace(',', '.');
    return new Money(toMoneyScale(new Decimal(normalized)), currency);
  }

  /** Creates a Money from a `Decimal`. */
  static fromDecimal(value: Decimal, currency: Currency = 'EUR'): Money {
    return new Money(toMoneyScale(value), currency);
  }

  /** Creates a zero amount. */
  static zero(currency: Currency = 'EUR'): Money {
    return new Money(toMoneyScale(new Decimal(0)), currency);
  }

  /**
   * Sums an array of amounts (zero for an empty array).
   * @throws {Error} When amounts have different currencies.
   */
  static sum(amounts: Money[]): Money {
    const first = amounts[0];
    if (!first) {
      return Money.zero();
    }

    const currency = first.currency;
    let total = new Decimal(0);
    for (const amount of amounts) {
      if (amount.currency !== currency) {
        throw new Error(`Cannot sum different currencies: ${currency} and ${amount.currency}`);
      }
      total = total.plus(amount.amount);
    }

    return new Money(toMoneyScale(total), currency);
  }

  /** Returns the underlying `Decimal` (in main currency units, e.g. euros). */
  toDecimal(): Decimal {
    return this.amount;
  }

  /** Returns the currency code. */
  getCurrency(): Currency {
    return this.currency;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Cannot perform operation between different currencies: ${this.currency} and ${other.currency}`,
      );
    }
  }

  /** Adds another amount. @throws {Error} On currency mismatch. */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(toMoneyScale(this.amount.plus(other.amount)), this.currency);
  }

  /** Subtracts another amount. @throws {Error} On currency mismatch. */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(toMoneyScale(this.amount.minus(other.amount)), this.currency);
  }

  /** Multiplies by a factor (e.g. a quantity). */
  multiply(factor: number | string | Decimal): Money {
    return new Money(toMoneyScale(this.amount.times(new Decimal(factor))), this.currency);
  }

  /** Divides by a divisor. @throws {Error} When divisor is zero. */
  divide(divisor: number | string | Decimal): Money {
    const divisorDecimal = new Decimal(divisor);
    if (divisorDecimal.isZero()) {
      throw new Error('Cannot divide by zero');
    }
    return new Money(toMoneyScale(this.amount.div(divisorDecimal)), this.currency);
  }

  /** Returns the negated amount. */
  negate(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  /** Returns the absolute value. */
  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  /** Returns true if the amount is exactly zero. */
  isZero(): boolean {
    return this.amount.isZero();
  }

  /** Returns true if the amount is greater than zero. */
  isPositive(): boolean {
    return this.amount.greaterThan(0);
  }

  /** Returns true if the amount is less than zero. */
  isNegative(): boolean {
    return this.amount.lessThan(0);
  }

  /** Returns true if both amount and currency are equal. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** @throws {Error} On currency mismatch. */
  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.greaterThan(other.amount);
  }

  /** @throws {Error} On currency mismatch. */
  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lessThan(other.amount);
  }

  /** @throws {Error} On currency mismatch. */
  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.greaterThanOrEqualTo(other.amount);
  }

  /** @throws {Error} On currency mismatch. */
  lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lessThanOrEqualTo(other.amount);
  }

  /**
   * Splits a gross amount (price incl. VAT) into net + vat at the given rate.
   * Net is rounded to the currency scale; vat is the exact remainder so the
   * `gross = net + vat` invariant always holds.
   *
   * @param ratePercent - Non-negative tax rate percentage (e.g. 20, 13, 10, 0).
   * @throws {Error} When the rate is negative.
   */
  extractTax(ratePercent: number): TaxBreakdown {
    if (ratePercent < 0) {
      throw new Error(`Tax rate cannot be negative: ${ratePercent}%`);
    }
    if (ratePercent === 0) {
      return { gross: this, net: this, vat: Money.zero(this.currency), rate: 0 };
    }

    const net = toMoneyScale(this.amount.times(100).div(100 + ratePercent));
    return {
      gross: this,
      net: new Money(net, this.currency),
      vat: new Money(toMoneyScale(this.amount.minus(net)), this.currency),
      rate: ratePercent,
    };
  }

  /**
   * Adds VAT to a net amount, producing the gross. Gross is rounded to the
   * currency scale; vat is the exact remainder (`gross = net + vat`).
   *
   * @param ratePercent - Non-negative tax rate percentage.
   * @throws {Error} When the rate is negative.
   */
  addTax(ratePercent: number): TaxBreakdown {
    if (ratePercent < 0) {
      throw new Error(`Tax rate cannot be negative: ${ratePercent}%`);
    }
    if (ratePercent === 0) {
      return { gross: this, net: this, vat: Money.zero(this.currency), rate: 0 };
    }

    const gross = toMoneyScale(this.amount.times(100 + ratePercent).div(100));
    return {
      gross: new Money(gross, this.currency),
      net: this,
      vat: new Money(toMoneyScale(gross.minus(this.amount)), this.currency),
      rate: ratePercent,
    };
  }

  /**
   * Formats as a localized currency string, e.g. `"€ 8,40"` (de-AT). Display
   * only — the value stays a decimal everywhere else.
   */
  format(locale: string = 'de-AT'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
    }).format(this.amount.toNumber());
  }

  /** Formats as a localized number without a currency symbol, e.g. `"8,40"`. */
  formatNumber(locale: string = 'de-AT'): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: SCALE,
      maximumFractionDigits: SCALE,
    }).format(this.amount.toNumber());
  }

  /** Plain fixed-scale decimal string with a dot separator, e.g. `"8.40"`. */
  toString(): string {
    return this.amount.toFixed(SCALE);
  }
}
