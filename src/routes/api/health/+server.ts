import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { log } from '$lib/server/log';
import { Money } from '$lib/money';
import type { RequestHandler } from './$types';

/**
 * Health check that proves the full app → Kysely → read-only DB path by
 * querying `pos.invoices`, and exercises the vendored `@calyx/money` by summing
 * `total` through `Money` (parsed from the numeric string via
 * `Money.fromDecimalString`, never raw-number math — CLAUDE.md rule 2).
 */
export const GET: RequestHandler = async () => {
  log.debug({}, 'Health check requested');

  try {
    const stats = await db
      .selectFrom('pos.invoices')
      .select((eb) => [
        eb.fn.countAll<string>().as('invoice_count'),
        eb.fn.sum<string | null>('total').as('total_sum'),
        eb.fn.min<string | null>('financial_date').as('first_day'),
        eb.fn.max<string | null>('financial_date').as('last_day'),
      ])
      .executeTakeFirstOrThrow();

    const invoiceCount = Number(stats.invoice_count);
    const total = Money.fromDecimalString(stats.total_sum ?? '0');

    log.debug(
      {
        invoiceCount,
        totalCents: total.toCents(),
        firstDay: stats.first_day,
        lastDay: stats.last_day,
      },
      'Health check computed invoice stats',
    );

    return json({
      status: 'ok',
      database: 'reachable',
      invoices: {
        count: invoiceCount,
        total: {
          cents: total.toCents(),
          formatted: total.format(),
        },
        financialDateSpan: {
          first: stats.first_day,
          last: stats.last_day,
        },
      },
    });
  } catch (err) {
    log.error({ err }, 'Health check failed');
    return json({ status: 'error', database: 'unreachable' }, { status: 503 });
  }
};
