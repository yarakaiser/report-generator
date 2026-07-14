# Calyx Report Generator — AI Reference

Standalone, **read-only** web reporting tool over the **legacy Calyx POS**
PostgreSQL database. Replicates the Calyx v2 *Berichtsgenerator*. Offline /
on-premise, deployed as a sidecar container — **not** SaaS. See `README.md` for
the full overview and phased roadmap.

## Tech stack

- **SvelteKit** standalone (Node adapter): `+server.ts` routes = backend,
  `+page.svelte` = UI
- **Kysely** (type-safe SQL builder), **read-only** + `pg`
- **`decimal.js`-backed `Money`** value object (`src/lib/money/`) for all currency
- **Puppeteer** (headless Chromium) → PDF; **CUPS** print queue for 80mm + A4
- **Vitest** for tests

## Absolute rules

1. **READ-ONLY DATABASE.** The tool must only `SELECT`. Never insert/update/
   delete/DDL against the POS database. Enforced by the `calyx_readonly` role,
   but code must never attempt writes either.
2. **MONEY = the `decimal.js`-backed `Money` (`src/lib/money/`), always.** It
   holds a `Decimal` in euros (matching `numeric(10,2)`), quantized to 2 dp — not
   integer cents. Parse DB decimals with `Money.fromDecimalString(...)`. Never do
   raw JS `number` currency math — no `x / 100`, `x * 100`,
   `Math.round(price*100)`, `.toFixed(2)` on a raw number, or
   `Intl.NumberFormat(currency)` on a raw number. Arithmetic via `money.add()`,
   `.subtract()`, `.multiply()`, `.divide()`, `Money.sum()`; VAT via
   `.extractTax(rate)` / `.addTax(rate)`. Any non-`Money` currency path is a
   blocking defect.
3. **No autonomous architecture/design decisions.** Ask the user. They prefer
   **conversational** clarification — one or two points at a time in text, not a
   big multi-question modal.
4. **Structured logging** (pino-style): context object first, message second —
   `log.debug({ invoiceId, count }, 'Grouped invoices')`. Log method entry, DB
   queries, computed values, and errors (use the `err` key for Error objects).
   No `console.log`. No silent `catch`.
5. **Verify before claiming done.** Typecheck + tests must pass; state failures
   honestly. Don't mark work complete without proof.

## Legacy schema — key facts (queries differ fundamentally from the v2 rewrite)

- **Money:** `numeric(10,2)` decimals (not integer cents).
- **Payments:** columns on `pos.invoices` — `payment_bar` (cash), `payment_debit`,
  `payment_credit`, `payment_voucher`, `payment_banktransfer`,
  `payment_internalconsumption`, `payment_allinclusive`, `payment_roomextern`,
  `payment_invitation`. (No payments table; breakdown = sum these columns.)
- **Tax:** per line item via `pos.invoiceitems.taxpercent`. VAT-rate breakdown is
  **computed** by grouping line items by `taxpercent` (no per-rate invoice cols).
- **Business day:** group on `pos.invoices.financial_date` (NOT `creation_timestamp`).
- **Operator:** `pos.invoices.username` (text). **Category:** `categoryname` joined
  via `pos.categorysort`.
- **Schemas:** `pos` (core), `posreporting` (log tables), `poslog` (partitioned
  financial log).
- **Full DDL reference:** `/home/frontend/CalyxSystems/pos_schema.sql` (schema-only
  dump; do NOT copy it into this public repo).
- **Concept reference (v2, for grouping/breakdown logic only — queries are a full
  rewrite):** `/home/frontend/CalyxSystems/apps/backend/src/pos/reports/report-builder.service.ts`.

## Test database

An isolated native **PostgreSQL 18** cluster (separate from the host's 5432
cluster) holding a copy of real legacy data.

- **Port 5433**, DB `Earthrise_DB_test`. Verified: 109 invoices,
  `sum(total)=1497.10`, span 2025-09-22 → 2026-07-01.
- Start it each session: `./testdb/start.sh` (also `stop.sh`, `rebuild.sh`).
- Read-only URL the app uses (local, throwaway test creds — safe to reference):
  `postgresql://calyx_readonly:readonly_test@127.0.0.1:5433/Earthrise_DB_test`
- Real/production DB credentials go in `.env` only (git-ignored) — never commit them.

## Status

Foundation + **Phase 0 complete**: SvelteKit (Node adapter) scaffold,
`decimal.js`-backed `Money` value object (`src/lib/money/`), read-only Kysely
`pg` pool (`src/lib/server/`
— `default_transaction_read_only=on`; `date` OID parsed as raw string to keep
`financial_date` timezone-safe), hand-written schema types for `pos.invoices` /
`pos.invoiceitems`, and `/api/health` verified against the test DB (109 invoices,
€ 1.497,10). Run: `pnpm dev` / `pnpm check` / `pnpm test` / `pnpm build`.
**Phase 1 next** (aggregation engine). Track progress against the `README.md`
roadmap.
