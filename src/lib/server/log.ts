import pino from 'pino';
import { env } from '$env/dynamic/private';

/**
 * Application-wide structured logger.
 *
 * Convention (see CLAUDE.md rule 4): context object first, message second —
 * `log.debug({ invoiceId, count }, 'Grouped invoices')`. Use the `err` key for
 * Error objects: `log.error({ err }, 'Query failed')`.
 */
export const log = pino({
  level: env.LOG_LEVEL ?? 'debug',
});
