import { db } from '../db';
import { log } from '../log';
import type { Invoice, InvoiceItem } from '../schema';
import type { InvoiceWithItems, ReportFilter } from './types';

/**
 * Columns selected for report invoices — the subset the aggregation engine
 * needs (identity, business day, operator, total, storno/training flags, and
 * every payment-method column). Selected explicitly rather than `SELECT *` to
 * avoid pulling heavy legacy columns (RKSV blobs, array types).
 */
const INVOICE_COLUMNS = [
  'invoice_id',
  'creation_timestamp',
  'username',
  'total',
  'financial_date',
  'is_training',
  'storno_source',
  'storno_target',
  'payment_bar',
  'payment_debit',
  'payment_credit',
  'payment_voucher',
  'payment_banktransfer',
  'payment_internalconsumption',
  'payment_allinclusive',
  'payment_roomextern',
  'payment_invitation',
] as const;

/** Columns selected for report line items. */
const ITEM_COLUMNS = [
  'invoiceitem_id',
  'invoice_id',
  'article_id',
  'article_name',
  'article_price',
  'quantity',
  'taxpercent',
  'is_zero',
] as const;

/**
 * Fetches the invoices matching a report filter, ordered by business day then
 * invoice id. Applies the `financial_date` range and the optional
 * training/storno exclusions (see {@link ReportFilter}).
 */
export async function fetchInvoices(filter: ReportFilter): Promise<Invoice[]> {
  log.debug({ filter }, 'Fetching invoices');

  let query = db
    .selectFrom('pos.invoices')
    .select(INVOICE_COLUMNS)
    .where('financial_date', '>=', filter.range.from)
    .where('financial_date', '<=', filter.range.to);

  if (filter.excludeTraining) {
    query = query.where('is_training', '=', false);
  }
  if (filter.excludeStorno) {
    query = query.where('storno_source', 'is', null);
  }

  const rows = await query.orderBy('financial_date').orderBy('invoice_id').execute();

  log.debug({ count: rows.length }, 'Fetched invoices');
  return rows;
}

/**
 * Fetches all line items belonging to the given invoice ids. Returns an empty
 * array when no ids are given (avoids an `IN ()` query).
 */
export async function fetchItemsForInvoices(invoiceIds: string[]): Promise<InvoiceItem[]> {
  if (invoiceIds.length === 0) {
    return [];
  }

  const rows = await db
    .selectFrom('pos.invoiceitems')
    .select(ITEM_COLUMNS)
    .where('invoice_id', 'in', invoiceIds)
    .execute();

  log.debug({ invoiceCount: invoiceIds.length, itemCount: rows.length }, 'Fetched invoice items');
  return rows;
}

/**
 * Fetches the filtered invoices together with their line items, grouped so each
 * invoice carries its own items. Invoices with no items get an empty array.
 */
export async function fetchInvoicesWithItems(filter: ReportFilter): Promise<InvoiceWithItems[]> {
  const invoices = await fetchInvoices(filter);
  const items = await fetchItemsForInvoices(invoices.map((i) => i.invoice_id));

  const itemsByInvoice = new Map<string, InvoiceItem[]>();
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoice_id);
    if (list) {
      list.push(item);
    } else {
      itemsByInvoice.set(item.invoice_id, [item]);
    }
  }

  return invoices.map((invoice) => ({
    invoice,
    items: itemsByInvoice.get(invoice.invoice_id) ?? [],
  }));
}
