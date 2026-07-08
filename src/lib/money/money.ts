import { Decimal } from 'decimal.js';

// Configure decimal.js for financial precision
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * Supported currency codes.
 * Currently only EUR is supported for Austrian POS system.
 */
export type Currency = 'EUR';

/**
 * Valid Austrian tax rates as defined by Austrian tax law.
 * - 20% - Standard rate (Normalsteuersatz)
 * - 13% - Reduced rate for accommodation (Ermäßigter Steuersatz)
 * - 10% - Reduced rate for food, books (Ermäßigter Steuersatz)
 * - 0% - Exempt (Steuerbefreit)
 */
export type AustrianTaxRate = 20 | 13 | 10 | 0;

const VALID_TAX_RATES: readonly AustrianTaxRate[] = [20, 13, 10, 0] as const;

/**
 * Result of tax extraction or addition operations.
 * Guarantees the invariant: gross = net + vat
 */
export interface TaxBreakdown {
  /** Total amount including VAT */
  gross: Money;
  /** Amount excluding VAT */
  net: Money;
  /** VAT amount */
  vat: Money;
  /** Tax rate percentage applied */
  rate: AustrianTaxRate;
}

/**
 * Immutable value object representing a monetary amount.
 *
 * All monetary operations in the Calyx POS system MUST use this class.
 * Stores amounts as integer cents to avoid floating point precision issues.
 * Uses decimal.js internally for arithmetic to ensure proper rounding.
 *
 * @example
 * ```typescript
 * // Create from cents (most common - from database/API)
 * const price = Money.fromCents(1050); // €10.50
 *
 * // Create from user input
 * const input = Money.fromDecimalString('10,50');
 *
 * // Arithmetic
 * const total = price.multiply(2);
 * const sum = Money.sum([price1, price2]);
 *
 * // Tax operations (Austrian compliance)
 * const { gross, net, vat } = price.extractTax(20);
 *
 * // Display
 * console.log(price.format());       // "€ 10,50"
 * console.log(price.formatNumber()); // "10,50"
 * ```
 */
export class Money {
  private readonly cents: number;
  private readonly currency: Currency;

  private constructor(cents: number, currency: Currency) {
    if (!Number.isInteger(cents)) {
      throw new Error(`Money cents must be an integer, got: ${cents}`);
    }
    this.cents = cents;
    this.currency = currency;
  }

  /**
   * Creates a Money instance from an integer cents value.
   * Primary factory method for values from database or API.
   *
   * @param cents - Integer value in cents (e.g., 1050 for €10.50)
   * @param currency - Currency code (default: 'EUR')
   * @returns New Money instance
   * @throws {Error} When cents is not an integer
   */
  static fromCents(cents: number, currency: Currency = 'EUR'): Money {
    if (!Number.isInteger(cents)) {
      throw new Error(`Money.fromCents requires an integer, got: ${cents}`);
    }
    return new Money(cents, currency);
  }

  /**
   * Creates a Money instance from a decimal string (user input).
   * Handles both comma and dot as decimal separator.
   *
   * @param value - Decimal string (e.g., "10,50" or "10.50")
   * @param currency - Currency code (default: 'EUR')
   * @returns New Money instance with value converted to cents
   */
  static fromDecimalString(value: string, currency: Currency = 'EUR'): Money {
    const normalized = value.replace(',', '.');
    const decimal = new Decimal(normalized);
    const cents = decimal.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    return new Money(cents, currency);
  }

  /**
   * Creates a Money instance representing zero.
   *
   * @param currency - Currency code (default: 'EUR')
   * @returns Money instance with zero value
   */
  static zero(currency: Currency = 'EUR'): Money {
    return new Money(0, currency);
  }

  /**
   * Returns the amount in cents as an integer.
   * Use this for database storage and API serialization.
   */
  toCents(): number {
    return this.cents;
  }

  /**
   * Returns the currency code.
   */
  getCurrency(): Currency {
    return this.currency;
  }

  /**
   * Returns the amount as a Decimal for precise calculations.
   * The result is in the main currency unit (e.g., euros, not cents).
   */
  toDecimal(): Decimal {
    return new Decimal(this.cents).div(100);
  }

  /**
   * Formats the amount as a localized currency string.
   *
   * @param locale - Locale code (default: 'de-AT' for Austrian format)
   * @returns Formatted string like "€ 10,50"
   */
  format(locale: string = 'de-AT'): string {
    const euros = this.cents / 100;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
    }).format(euros);
  }

  /**
   * Formats the amount as a localized number without currency symbol.
   *
   * @param locale - Locale code (default: 'de-AT' for Austrian format)
   * @returns Formatted string like "10,50"
   */
  formatNumber(locale: string = 'de-AT'): string {
    const euros = this.cents / 100;
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(euros);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Cannot perform operation between different currencies: ${this.currency} and ${other.currency}`,
      );
    }
  }

  /**
   * Adds another Money amount. Returns a new Money instance.
   * @throws {Error} When currencies don't match
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  /**
   * Subtracts another Money amount. Returns a new Money instance.
   * @throws {Error} When currencies don't match
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  /**
   * Multiplies by a factor (e.g., quantity). Returns a new Money instance.
   * Uses ROUND_HALF_UP for proper financial rounding.
   */
  multiply(factor: number | string): Money {
    const factorDecimal = new Decimal(factor);
    const resultCents = new Decimal(this.cents)
      .times(factorDecimal)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    return new Money(resultCents, this.currency);
  }

  /**
   * Divides by a divisor. Returns a new Money instance.
   * @throws {Error} When divisor is zero
   */
  divide(divisor: number | string): Money {
    const divisorDecimal = new Decimal(divisor);
    if (divisorDecimal.isZero()) {
      throw new Error('Cannot divide by zero');
    }
    const resultCents = new Decimal(this.cents)
      .div(divisorDecimal)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    return new Money(resultCents, this.currency);
  }

  /** Returns the negated amount. */
  negate(): Money {
    return new Money(-this.cents, this.currency);
  }

  /** Returns the absolute value. */
  abs(): Money {
    return new Money(Math.abs(this.cents), this.currency);
  }

  /** Returns true if amount is exactly zero. */
  isZero(): boolean {
    return this.cents === 0;
  }

  /** Returns true if amount is greater than zero. */
  isPositive(): boolean {
    return this.cents > 0;
  }

  /** Returns true if amount is less than zero. */
  isNegative(): boolean {
    return this.cents < 0;
  }

  /** Returns true if both amount and currency are equal. */
  equals(other: Money): boolean {
    return this.cents === other.cents && this.currency === other.currency;
  }

  /** @throws {Error} When currencies don't match */
  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents > other.cents;
  }

  /** @throws {Error} When currencies don't match */
  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  /** @throws {Error} When currencies don't match */
  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents >= other.cents;
  }

  /** @throws {Error} When currencies don't match */
  lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents <= other.cents;
  }

  /**
   * Extracts tax from a gross amount (price including VAT).
   * Used for Austrian tax calculation where prices include VAT.
   *
   * @param rate - Austrian tax rate (20, 13, 10, or 0)
   * @returns Tax breakdown with gross, net, vat amounts
   * @throws {Error} When rate is not a valid Austrian tax rate
   */
  extractTax(rate: AustrianTaxRate): TaxBreakdown {
    if (!VALID_TAX_RATES.includes(rate)) {
      throw new Error(
        `Invalid Austrian tax rate: ${rate}%. Valid rates: ${VALID_TAX_RATES.join(', ')}`,
      );
    }
    return this.extractTaxGeneric(rate);
  }

  extractTaxGeneric(ratePercent: number): TaxBreakdown {
    if (ratePercent < 0) {
      throw new Error(`Tax rate cannot be negative: ${ratePercent}%`);
    }

    if (ratePercent === 0) {
      return {
        gross: this,
        net: this,
        vat: Money.zero(this.currency),
        rate: ratePercent as AustrianTaxRate,
      };
    }

    const grossDecimal = new Decimal(this.cents);
    const netDecimal = grossDecimal.times(100).div(100 + ratePercent);
    const netCents = netDecimal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    const vatCents = this.cents - netCents;

    return {
      gross: this,
      net: new Money(netCents, this.currency),
      vat: new Money(vatCents, this.currency),
      rate: ratePercent as AustrianTaxRate,
    };
  }

  /**
   * Adds tax to a net amount (price excluding VAT).
   * Calculates gross price from a net price.
   *
   * @param rate - Austrian tax rate (20, 13, 10, or 0)
   * @returns Tax breakdown where this amount is the net
   * @throws {Error} When rate is not a valid Austrian tax rate
   */
  addTax(rate: AustrianTaxRate): TaxBreakdown {
    if (!VALID_TAX_RATES.includes(rate)) {
      throw new Error(
        `Invalid Austrian tax rate: ${rate}%. Valid rates: ${VALID_TAX_RATES.join(', ')}`,
      );
    }

    if (rate === 0) {
      return {
        gross: this,
        net: this,
        vat: Money.zero(this.currency),
        rate,
      };
    }

    const netDecimal = new Decimal(this.cents);
    const grossDecimal = netDecimal.times(100 + rate).div(100);
    const grossCents = grossDecimal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    const vatCents = grossCents - this.cents;

    return {
      gross: new Money(grossCents, this.currency),
      net: this,
      vat: new Money(vatCents, this.currency),
      rate,
    };
  }

  /**
   * Sums an array of Money amounts.
   *
   * @param amounts - Array of Money instances to sum
   * @returns Total as a new Money instance (zero if empty array)
   * @throws {Error} When amounts have different currencies
   */
  static sum(amounts: Money[]): Money {
    if (amounts.length === 0) {
      return Money.zero();
    }

    const first = amounts[0];
    if (!first) {
      return Money.zero();
    }

    const currency = first.currency;
    let totalCents = 0;

    for (const amount of amounts) {
      if (amount.currency !== currency) {
        throw new Error(`Cannot sum different currencies: ${currency} and ${amount.currency}`);
      }
      totalCents += amount.cents;
    }

    return new Money(totalCents, currency);
  }

  /**
   * Allocates amount across ratios, handling rounding remainder.
   * Useful for splitting bills or distributing discounts.
   *
   * @param ratios - Array of numeric ratios (e.g., [1, 1, 2] for 25%, 25%, 50%)
   * @returns Array of Money instances that sum to this amount
   * @throws {Error} When ratios array is empty or sums to zero
   */
  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) {
      throw new Error('Cannot allocate to zero ratios');
    }

    const total = ratios.reduce((sum, r) => sum + r, 0);
    if (total === 0) {
      throw new Error('Sum of ratios cannot be zero');
    }

    const results: Money[] = [];
    let remainder = this.cents;

    for (let i = 0; i < ratios.length; i++) {
      const ratio = ratios[i];
      if (ratio === undefined) continue;

      const share = new Decimal(this.cents)
        .times(ratio)
        .div(total)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();

      results.push(new Money(share, this.currency));
      remainder -= share;
    }

    if (remainder !== 0 && results.length > 0) {
      const lastIndex = results.length - 1;
      const last = results[lastIndex];
      if (last) {
        results[lastIndex] = new Money(last.cents + remainder, this.currency);
      }
    }

    return results;
  }

  /** Returns string representation for debugging. */
  toString(): string {
    return `${this.formatNumber()} ${this.currency}`;
  }

  /** Serializes to JSON-safe object for API responses. */
  toJSON(): { cents: number; currency: Currency } {
    return {
      cents: this.cents,
      currency: this.currency,
    };
  }

  /** Deserializes from JSON object. */
  static fromJSON(json: { cents: number; currency: Currency }): Money {
    return Money.fromCents(json.cents, json.currency);
  }
}
