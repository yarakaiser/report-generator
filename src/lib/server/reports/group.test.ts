import { afterAll, describe, expect, it } from 'vitest';
import { Money } from '$lib/money';
import { db } from '../db';
import type { Invoice } from '../schema';
import { byDay, byMonth, byOperator, groupBy, type GroupNode } from './group';
import { fetchInvoicesWithItems } from './query';
import type { InvoiceWithItems, ReportFilter } from './types';

/**
 * Tests for the recursive multi-level grouping engine. Integration cases run
 * against the :5433 cluster; a pure unit case pins the tree shape.
 */

const FULL_RANGE: ReportFilter = { range: { from: '2025-09-22', to: '2026-07-01' } };

afterAll(async () => {
  await db.destroy();
});

/** Sums the gross of a node list. */
function sumGross(nodes: GroupNode[]): Money {
  return Money.sum(nodes.map((n) => n.aggregate.gross));
}

describe('groupBy — single level against real rows', () => {
  it('groups by day: 33 days, chronological, summing to the grand total', async () => {
    const report = groupBy(await fetchInvoicesWithItems(FULL_RANGE), [byDay]);
    expect(report.dimensions).toEqual(['day']);
    expect(report.groups).toHaveLength(33);

    // Ordered ascending by date.
    const keys = report.groups.map((g) => g.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys[0]).toBe('2025-09-22');
    expect(keys.at(-1)).toBe('2026-07-01');

    // A known day.
    const firstDay = report.groups[0]!;
    expect(firstDay.aggregate.invoiceCount).toBe(2);
    expect(firstDay.aggregate.gross.toString()).toBe('8.40');

    // Leaves sum to the grand total.
    expect(sumGross(report.groups).equals(report.total.gross)).toBe(true);
    expect(report.total.gross.toString()).toBe('1497.10');
  });

  it('groups by operator with the expected per-operator gross', async () => {
    const report = groupBy(await fetchInvoicesWithItems(FULL_RANGE), [byOperator]);
    const byName = new Map(report.groups.map((g) => [g.key, g.aggregate]));
    expect([...byName.keys()]).toEqual(['cashbook', 'kaiser', 'kellner']);
    expect(byName.get('cashbook')!.gross.toString()).toBe('0.00');
    expect(byName.get('kaiser')!.gross.toString()).toBe('1049.60');
    expect(byName.get('kellner')!.gross.toString()).toBe('447.50');
  });
});

describe('groupBy — multi-level nesting', () => {
  it('nests operator → day with children summing to their parent', async () => {
    const report = groupBy(await fetchInvoicesWithItems(FULL_RANGE), [byOperator, byMonth]);
    expect(report.dimensions).toEqual(['operator', 'month']);

    for (const operator of report.groups) {
      expect(operator.dimension).toBe('operator');
      expect(operator.children.length).toBeGreaterThan(0);
      // Each child is a month, and the months sum back to the operator total.
      expect(operator.children.every((c) => c.dimension === 'month')).toBe(true);
      expect(sumGross(operator.children).equals(operator.aggregate.gross)).toBe(true);
    }

    // Top level still sums to the grand total.
    expect(sumGross(report.groups).equals(report.total.gross)).toBe(true);
  });
});

describe('groupBy — deterministic unit', () => {
  const invoice = (over: Partial<Invoice>): InvoiceWithItems => ({
    invoice: {
      invoice_id: '0',
      username: 'x',
      financial_date: '2025-01-01',
      total: '0.00',
      payment_bar: '0.00',
      payment_debit: '0.00',
      payment_credit: '0.00',
      payment_voucher: '0.00',
      payment_banktransfer: '0.00',
      payment_internalconsumption: '0.00',
      payment_allinclusive: '0.00',
      payment_roomextern: '0.00',
      payment_invitation: '0.00',
      ...over,
    } as unknown as Invoice,
    items: [],
  });

  it('partitions into the right tree with parent = Σ children', () => {
    const rows = [
      invoice({ username: 'ann', financial_date: '2025-01-01', total: '10.00', payment_bar: '10.00' }),
      invoice({ username: 'ann', financial_date: '2025-01-02', total: '5.00', payment_bar: '5.00' }),
      invoice({ username: 'bob', financial_date: '2025-01-01', total: '3.00', payment_bar: '3.00' }),
    ];
    const report = groupBy(rows, [byOperator, byDay]);

    expect(report.total.gross.toString()).toBe('18.00');
    expect(report.groups.map((g) => g.key)).toEqual(['ann', 'bob']);

    const ann = report.groups[0]!;
    expect(ann.aggregate.gross.toString()).toBe('15.00');
    expect(ann.children.map((c) => c.key)).toEqual(['2025-01-01', '2025-01-02']);
    expect(ann.children.map((c) => c.aggregate.gross.toString())).toEqual(['10.00', '5.00']);

    const bob = report.groups[1]!;
    expect(bob.aggregate.gross.toString()).toBe('3.00');
    expect(bob.children).toHaveLength(1);
  });
});
