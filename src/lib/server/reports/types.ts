import type { Invoice, InvoiceItem } from '../schema';

/**
 * Inclusive business-day range for a report. Bounds are `financial_date`
 * strings in `'YYYY-MM-DD'` form (see CLAUDE.md — group on `financial_date`,
 * never `creation_timestamp`).
 */
export interface DateRange {
  /** Inclusive lower bound, `'YYYY-MM-DD'`. */
  from: string;
  /** Inclusive upper bound, `'YYYY-MM-DD'`. */
  to: string;
}

/**
 * The filter that selects which invoices a report is built from.
 */
export interface ReportFilter {
  /** Inclusive `financial_date` range. */
  range: DateRange;
  /**
   * Exclude training-mode invoices (`is_training = true`). Default: `false`.
   */
  excludeTraining?: boolean;
  /**
   * Exclude storno **reversal** invoices (`storno_source IS NOT NULL`) — the
   * negative cancelling invoices. The original cancelled invoice is kept, so a
   * voided sale still shows on its financial day (matches the Calyx v2
   * behaviour). Default: `false`.
   */
  excludeStorno?: boolean;
}

/** An invoice together with its line items. */
export interface InvoiceWithItems {
  invoice: Invoice;
  items: InvoiceItem[];
}
