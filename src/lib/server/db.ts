import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '$env/dynamic/private';
import { log } from './log';
import type { Database } from './schema';

// Return `date` (OID 1082) columns as the raw 'YYYY-MM-DD' string instead of a
// JS Date. pg's default parser builds a Date at *local* midnight, which shifts
// the calendar day when serialized to UTC — corrupting `financial_date`, the
// business-day grouping key for every report. Keep it a plain string so Money-
// free date logic stays exact and timezone-independent. (numeric/int8 already
// come back as strings by default, which we rely on for Money parsing.)
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/**
 * Read-only connection to the legacy Calyx POS PostgreSQL database.
 *
 * The tool must only ever `SELECT` (CLAUDE.md rule 1). This is enforced at three
 * layers: the `calyx_readonly` DB role, `default_transaction_read_only=on` set on
 * every connection here, and code that never issues writes.
 *
 * `DATABASE_URL` comes from the environment; it defaults to the local isolated
 * test cluster (throwaway creds, safe to reference — see CLAUDE.md / testdb/).
 */
const DEFAULT_TEST_URL =
  'postgresql://calyx_readonly:readonly_test@127.0.0.1:5433/Earthrise_DB_test';

const connectionString = env.DATABASE_URL ?? DEFAULT_TEST_URL;

// Cache the pool on globalThis so Vite HMR in dev doesn't leak a new pool per
// module re-evaluation.
const globalForDb = globalThis as unknown as { __calyxPool?: pg.Pool };

const pool =
  globalForDb.__calyxPool ??
  new pg.Pool({
    connectionString,
    // Defense-in-depth: force every session to reject writes at the server.
    options: '-c default_transaction_read_only=on',
    max: 10,
  });

if (!globalForDb.__calyxPool) {
  globalForDb.__calyxPool = pool;
  pool.on('error', (err) => {
    log.error({ err }, 'Idle Postgres client error');
  });
  log.debug({ connectionString: connectionString.replace(/:[^:@/]*@/, ':***@') }, 'Postgres pool created');
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
