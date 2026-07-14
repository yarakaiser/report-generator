import { afterAll, describe, expect, it } from 'vitest';
import { Money } from '$lib/money';
import { db } from '../db';
import { fetchInvoices, fetchInvoicesWithItems, fetchItemsForInvoices } from './query';
import type { ReportFilter } from './types';

/**
 * Integration tests against the isolated test cluster (:5433) — "unit-tested
 * against real rows" per the Phase 1 roadmap. Requires the test DB to be up
 * (`./testdb/start.sh`). Known fixture: 109 invoices, sum(total) € 1.497,10,
 * financial_date span 2025-09-22 → 2026-07-01, 2 storno reversals, 0 training.
 */

const FULL_RANGE: ReportFilter = { range: { from: '2025-09-22', to: '2026-07-01' } };

afterAll(async () => {
  await db.destroy();
});

describe('fetchInvoices', () => {
  it('returns every invoice in the full financial-date range', async () => {
    const invoices = await fetchInvoices(FULL_RANGE);
    expect(invoices).toHaveLength(109);
  });

  it('sums total to € 1.497,10 through Money', async () => {
    const invoices = await fetchInvoices(FULL_RANGE);
    const total = Money.sum(invoices.map((i) => Money.fromDecimalString(i.total)));
    expect(total.toString()).toBe('1497.10');
  });

  it('orders by financial_date then invoice_id', async () => {
    const invoices = await fetchInvoices(FULL_RANGE);
    for (let i = 1; i < invoices.length; i++) {
      const prev = invoices[i - 1]!;
      const cur = invoices[i]!;
      const ordered =
        prev.financial_date < cur.financial_date ||
        (prev.financial_date === cur.financial_date && BigInt(prev.invoice_id) <= BigInt(cur.invoice_id));
      expect(ordered).toBe(true);
    }
  });

  it('excludes storno reversals but keeps the originals when excludeStorno is set', async () => {
    const invoices = await fetchInvoices({ ...FULL_RANGE, excludeStorno: true });
    expect(invoices).toHaveLength(107);
    // No reversal (storno_source set) survives...
    expect(invoices.every((i) => i.storno_source === null)).toBe(true);
    // ...but the original cancelled invoice (4398, storno_target set) is kept.
    expect(invoices.some((i) => i.invoice_id === '4398')).toBe(true);
  });

  it('excludeTraining is a no-op on this fixture (0 training invoices)', async () => {
    const invoices = await fetchInvoices({ ...FULL_RANGE, excludeTraining: true });
    expect(invoices).toHaveLength(109);
  });

  it('narrows to a single business day', async () => {
    const invoices = await fetchInvoices({ range: { from: '2025-09-22', to: '2025-09-22' } });
    expect(invoices.map((i) => i.invoice_id)).toEqual(['4314', '4315']);
  });
});

describe('fetchItemsForInvoices', () => {
  it('returns [] for no ids without hitting the DB', async () => {
    expect(await fetchItemsForInvoices([])).toEqual([]);
  });

  it('fetches the line items of an invoice', async () => {
    const items = await fetchItemsForInvoices(['4316']);
    expect(items).toHaveLength(6);
    const gross = Money.sum(items.map((it) => Money.fromDecimalString(it.article_price)));
    expect(gross.toString()).toBe('8.10');
  });
});

describe('fetchInvoicesWithItems', () => {
  it('attaches each invoice its own items', async () => {
    const rows = await fetchInvoicesWithItems({ range: { from: '2025-09-22', to: '2025-09-23' } });
    const invoice4316 = rows.find((r) => r.invoice.invoice_id === '4316');
    expect(invoice4316).toBeDefined();
    expect(invoice4316!.items).toHaveLength(6);
    // Every returned item really belongs to its invoice.
    for (const { invoice, items } of rows) {
      expect(items.every((it) => it.invoice_id === invoice.invoice_id)).toBe(true);
    }
  });
});
