import type { ColumnType, Generated, Selectable } from 'kysely';

/**
 * Hand-written Kysely types for the subset of the **legacy** Calyx POS schema
 * this tool reads. This is intentionally partial — only the tables and columns
 * in active use are declared, and it grows as later phases query more.
 *
 * Conventions:
 * - PostgreSQL `numeric` columns are returned by `pg` as **strings**. They are
 *   typed `string` here so callers parse them with `Money.fromDecimalString(...)`
 *   — never as `number` (CLAUDE.md rule 2).
 * - `date` columns are returned as `'YYYY-MM-DD'` strings.
 * - `timestamp without time zone` columns are returned as `Date`.
 *
 * The database is strictly **read-only** (CLAUDE.md rule 1), so insert/update
 * column types are irrelevant; every table is consumed via `Selectable`.
 */

/** `pos.invoices` — one row per POS invoice (business day = `financial_date`). */
export interface InvoicesTable {
  invoice_id: Generated<string>;
  creation_timestamp: ColumnType<Date, never, never>;
  username: string;
  /** numeric(10,2) — grand total incl. VAT. Parse with Money. */
  total: string;
  /** date 'YYYY-MM-DD' — business day to group on. */
  financial_date: string;
  is_training: boolean;
  storno_source: string | null;
  storno_target: string | null;
  // --- Payment breakdown columns (numeric, parse with Money) ---
  payment_bar: string;
  payment_debit: string;
  payment_credit: string;
  payment_voucher: string;
  payment_banktransfer: string;
  payment_internalconsumption: string;
  payment_allinclusive: string;
  payment_roomextern: string;
  payment_invitation: string;
}

/** `pos.invoiceitems` — line items belonging to an invoice. */
export interface InvoiceItemsTable {
  invoiceitem_id: Generated<string>;
  invoice_id: string;
  article_id: string;
  article_name: string;
  /** numeric — unit price. Parse with Money. */
  article_price: string;
  /** numeric — quantity (may be fractional). */
  quantity: string;
  /** numeric — VAT rate for this line, e.g. 20, 13, 10, 0. */
  taxpercent: string;
  is_zero: boolean;
}

/**
 * The Kysely database interface. Keys are schema-qualified table names so
 * queries read `db.selectFrom('pos.invoices')`.
 */
export interface Database {
  'pos.invoices': InvoicesTable;
  'pos.invoiceitems': InvoiceItemsTable;
}

export type Invoice = Selectable<InvoicesTable>;
export type InvoiceItem = Selectable<InvoiceItemsTable>;
