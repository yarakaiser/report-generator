import { log } from '../log';
import { computeInvoiceAggregate, mergeAggregates, type Aggregate } from './aggregate';
import type { InvoiceWithItems } from './types';

/**
 * A grouping dimension: derives a group key from an invoice. Dimensions are
 * invoice-level for now (category / article, which live on line items, come in
 * Phase 2).
 */
export interface Dimension {
  /** Stable identifier, e.g. `'day'`, `'operator'`. */
  readonly name: string;
  /** Derives this row's key for the dimension, e.g. `'2025-09-22'`. */
  keyOf(row: InvoiceWithItems): string;
}

/** A node in the grouping tree: one group at one level, plus its sub-groups. */
export interface GroupNode {
  /** The dimension that produced this level, e.g. `'day'`. */
  dimension: string;
  /** This group's key, e.g. `'2025-09-22'` or an operator name. */
  key: string;
  /** Aggregate over every invoice in this group (all descendants included). */
  aggregate: Aggregate;
  /** Sub-groups by the next dimension; empty at the leaf level. */
  children: GroupNode[];
}

/** The result of grouping: a grand total plus the top-level group tree. */
export interface GroupedReport {
  /** The ordered dimension names applied, outermost first. */
  dimensions: string[];
  /** Aggregate over all rows (the grand total). */
  total: Aggregate;
  /** Top-level groups (first dimension). */
  groups: GroupNode[];
}

// --- Built-in invoice-level dimensions ---

/** Group by business day (`financial_date`, `'YYYY-MM-DD'`). */
export const byDay: Dimension = {
  name: 'day',
  keyOf: (row) => row.invoice.financial_date,
};

/** Group by calendar month (`'YYYY-MM'`, derived from `financial_date`). */
export const byMonth: Dimension = {
  name: 'month',
  keyOf: (row) => row.invoice.financial_date.slice(0, 7),
};

/** Group by calendar year (`'YYYY'`, derived from `financial_date`). */
export const byYear: Dimension = {
  name: 'year',
  keyOf: (row) => row.invoice.financial_date.slice(0, 4),
};

/** Group by operator (`username`). */
export const byOperator: Dimension = {
  name: 'operator',
  keyOf: (row) => row.invoice.username,
};

/** An invoice paired with its precomputed aggregate (computed once, merged up). */
interface Contribution {
  row: InvoiceWithItems;
  aggregate: Aggregate;
}

/**
 * Builds one level of the group tree and recurses into the remaining dimensions.
 * Groups are ordered by key ascending — chronological for the date dimensions
 * (`'YYYY-MM-DD'` etc. sort lexicographically) and alphabetical for operators.
 */
function buildLevel(contributions: Contribution[], dimensions: Dimension[], depth: number): GroupNode[] {
  if (depth >= dimensions.length) {
    return [];
  }

  const dimension = dimensions[depth]!;
  const partitions = new Map<string, Contribution[]>();
  for (const contribution of contributions) {
    const key = dimension.keyOf(contribution.row);
    const list = partitions.get(key);
    if (list) {
      list.push(contribution);
    } else {
      partitions.set(key, [contribution]);
    }
  }

  return [...partitions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({
      dimension: dimension.name,
      key,
      aggregate: mergeAggregates(group.map((c) => c.aggregate)),
      children: buildLevel(group, dimensions, depth + 1),
    }));
}

/**
 * Groups invoices-with-items by an ordered list of dimensions, producing a tree
 * with a full {@link Aggregate} at every node and a grand total. Each invoice's
 * aggregate is computed once and merged up, so a parent always equals the sum of
 * its children (merging is exact Money addition).
 */
export function groupBy(rows: InvoiceWithItems[], dimensions: Dimension[]): GroupedReport {
  log.debug({ rows: rows.length, dimensions: dimensions.map((d) => d.name) }, 'Grouping invoices');

  const contributions: Contribution[] = rows.map((row) => ({
    row,
    aggregate: computeInvoiceAggregate(row),
  }));

  const report: GroupedReport = {
    dimensions: dimensions.map((d) => d.name),
    total: mergeAggregates(contributions.map((c) => c.aggregate)),
    groups: buildLevel(contributions, dimensions, 0),
  };

  log.debug(
    { dimensions: report.dimensions, topLevelGroups: report.groups.length, gross: report.total.gross.toString() },
    'Grouped invoices',
  );
  return report;
}
