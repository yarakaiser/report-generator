# Calyx Report Generator

A standalone, web-based reporting tool for the **legacy Calyx POS** database. It
reproduces the reporting capability of the Calyx v2 *Berichtsgenerator* as an
independent application that connects **read-only** to a POS PostgreSQL database
and turns its sales data into formatted reports — either downloadable **PDF** or
printed directly on **80mm thermal** or **A4** paper.

## What it does

- Connects to a legacy Calyx POS PostgreSQL database **read-only** — it can never
  modify POS data.
- Produces the core sales reports (daily, monthly, yearly, by article, by payment
  method, by operator) with the same totals / tax / payment breakdowns the POS
  produces.
- Renders each report from an HTML/CSS **template**, so the same report definition
  drives both an A4 layout and an 80mm receipt layout.
- Outputs a **PDF** to download and save, or sends it to the operating system's
  **print queue** (CUPS) for direct printing.

### Deployment model

Designed to run as a **sidecar container** next to the POS container, on a
separate server. This is **not** a SaaS product — it is an offline, on-premise
tool for local / multi-client POS installs.

## Target database

The tool reads the **legacy** Calyx POS schema (`pos.*`, `posreporting.*`,
`poslog.*`), which differs significantly from the v2 rewrite:

| Aspect | Legacy (this tool's target) |
| --- | --- |
| Money | `numeric(10,2)` decimals |
| Payment methods | columns on `pos.invoices` (`payment_bar`, `payment_debit`, …) |
| Tax | per line item via `invoiceitems.taxpercent` (breakdown is computed) |
| Business day | explicit `financial_date` column |
| Operator | `invoices.username` (text) |
| Category | by `categoryname` (via `pos.categorysort`) |

All monetary values are handled through a `decimal.js`-backed `Money` value
object (holds a `Decimal` in euros matching `numeric(10,2)`, parsed from DB
decimals with `Money.fromDecimalString`) — raw `number` arithmetic on currency
is never used.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js |
| App framework | **SvelteKit** (standalone, Node adapter) — `+server.ts` routes are the backend, `+page.svelte` is the UI |
| Database access | **Kysely** (type-safe SQL query builder), **read-only** |
| Database | PostgreSQL (legacy Calyx POS schema) |
| Money | `decimal.js`-backed `Money` value object (`src/lib/money/`) |
| Rendering | HTML/CSS templates → **Puppeteer** (headless Chromium) → PDF |
| Printing | PDF → OS print queue (**CUPS**) for both 80mm and A4 |
| Testing | Vitest |

## Roadmap

Built in phases; each phase leaves something runnable and verifiable. **Presets
first** — the custom query builder comes after the end-to-end pipeline is proven.

- [x] **Foundation** — read-only DB role (`setup-readonly-role.sql`) and an
      isolated test database (see [`testdb/`](./testdb/README.md)) holding a copy
      of real legacy data.
- [x] **Phase 0 — Scaffold & connection.** SvelteKit + Node adapter, vendored
      `decimal.js`-backed `Money`, Kysely `pg` pool on the read-only URL, hand-written types
      for the `pos.*` tables in use, and a health route (`/api/health`) that
      queries `pos.invoices` to prove the app→DB path.
- [x] **Phase 1 — Aggregation engine.** Filters (`financial_date` range, exclude
      training/storno), fetch invoices + items, and compute totals / tax-by-rate /
      payment-by-column breakdowns through `Money`, with recursive multi-level
      grouping (`day` / `month` / `year` / `operator`). Unit-tested against real
      rows. (Category/article grouping deferred to Phase 2.)
- [ ] **Phase 2 — Preset reports.** Daily (by payment method), Monthly (by day),
      Yearly (by month), Article (category → article), Payment (method → operator),
      Operator (operator → day).
- [ ] **Phase 3 — Render & print.** HTML/CSS templates → Puppeteer → PDF, with
      A4 and 80mm `@page` variants; download endpoint + CUPS print endpoint.
- [ ] **Phase 4 — UI.** Select a report, date range, and format; preview;
      download or print.
- [ ] **Later — Custom query builder.** Arbitrary filters + multi-level grouping,
      once the preset pipeline is solid.

## Development

### Test database

An isolated PostgreSQL 18 cluster with a copy of real legacy data runs on port
`5433`. Bring it up before working on the app:

```bash
./testdb/start.sh    # start the isolated test cluster (once per session)
./testdb/stop.sh     # stop it
```

Read-only connection string used by the app:

```
postgresql://calyx_readonly:readonly_test@127.0.0.1:5433/Earthrise_DB_test
```

See [`testdb/README.md`](./testdb/README.md) for details and how to refresh the
data from a source database.

### Phase 0 — Scaffold & connection

The application shell and the read-only app→DB path are in place and verified.

**Commands** (uses `pnpm`):

```bash
pnpm install     # install dependencies
pnpm dev         # run the dev server (Vite)
pnpm build       # production build (Node adapter)
pnpm check       # svelte-check typecheck
pnpm test        # Vitest (run once)
```

**What was built:**

- **SvelteKit** standalone with the **Node adapter** (`svelte.config.js`) — a
  minimal `+page.svelte` UI and `+server.ts` API routes.
- **[`Money`](./src/lib/money/) value object** — a `decimal.js`-backed currency
  type holding a `Decimal` in euros (matching `numeric(10,2)`), quantized to 2 dp,
  with tax extraction (`extractTax`/`addTax`) and de-AT formatting. All money is
  parsed from DB decimal strings via `Money.fromDecimalString(...)`; raw `number`
  currency math is never used.
- **Read-only Kysely `pg` pool** ([`src/lib/server/db.ts`](./src/lib/server/db.ts))
  on the read-only connection string. Writes are blocked at three layers: the
  `calyx_readonly` role, `default_transaction_read_only=on` on every session, and
  code that only ever `SELECT`s. PostgreSQL `date` columns are parsed as raw
  `'YYYY-MM-DD'` strings so `financial_date` (the business-day grouping key) is
  never shifted by timezone conversion.
- **Hand-written schema types** ([`src/lib/server/schema.ts`](./src/lib/server/schema.ts))
  for the `pos.invoices` and `pos.invoiceitems` columns in use — an intentionally
  partial map that grows with later phases. `numeric` columns are typed as
  `string` so they can only be consumed through `Money`.
- **Structured logging** ([`src/lib/server/log.ts`](./src/lib/server/log.ts)) via
  `pino` (context object first, message second).
- **Health route** [`/api/health`](./src/routes/api/health/+server.ts) — queries
  `pos.invoices` and sums `total` through `Money`, proving the full app→DB path.
  Verified against the test database: **109 invoices**, total **€ 1.497,10**,
  financial-date span **2025-09-22 → 2026-07-01**.

Configuration lives in the environment (see [`.env.example`](./.env.example)):
`DATABASE_URL` (defaults to the local test cluster if unset) and `LOG_LEVEL`.

### Phase 1 — Aggregation engine

The read-only computation core, in [`src/lib/server/reports/`](./src/lib/server/reports/),
built and unit-tested against real rows from the test cluster.

**What was built:**

- **Filter + fetch layer** ([`query.ts`](./src/lib/server/reports/query.ts),
  [`types.ts`](./src/lib/server/reports/types.ts)) — a `ReportFilter`
  (`financial_date` range, `excludeTraining`, `excludeStorno`) and
  `fetchInvoices` / `fetchInvoicesWithItems`. `excludeStorno` drops the reversal
  invoices (`storno_source IS NOT NULL`) and keeps the original (matches Calyx
  v2). Explicit column lists avoid pulling heavy legacy columns.
- **Aggregation** ([`aggregate.ts`](./src/lib/server/reports/aggregate.ts)) —
  turns a set of invoices-with-items into **gross / net / vat** totals, a
  **VAT-by-rate** breakdown, and a **payment-method** breakdown, all through
  `Money`. Three legacy-data rules are baked in:
  - **Gross (brutto)** is the invoice `total` — the authoritative price.
  - **VAT is extracted per invoice, per rate** (group that invoice's lines by
    `taxpercent`, sum, split once) — this reproduces the POS's own
    `vat` / `nettoprice` figures exactly (0 of 109 invoices differ).
  - **Rollup lines are dropped** (`article_id = -5`, the synthetic
    "Lieferschein …" delivery-note subtotal lines) so collective invoices don't
    double-count. Genuine 0 % detail (e.g. `Pfand` deposits, `article_id = -8`)
    is kept.
  - **Payments use a booked-revenue basis** — over-tendered cash change
    (`Σpayments − total`) is subtracted from `payment_bar`, so each invoice's
    payments reconcile to its `total` (the `amount_retour` column is unreliable).
- **Recursive grouping** ([`group.ts`](./src/lib/server/reports/group.ts)) —
  `groupBy(rows, dimensions)` partitions invoices by an ordered list of
  dimensions into a tree, with a full aggregate at every node and a grand total;
  a parent always equals the sum of its children. Invoice-level dimensions ship
  now: `byDay`, `byMonth`, `byYear`, `byOperator`. (Category / article grouping
  is item-level and comes in Phase 2.)

Verified against the test database: grand totals **gross € 1.497,10 / net
€ 1.262,00 / vat € 235,10**, VAT rates **20 % / 10 % / 0 %**, payments **cash
€ 1.209,90 / debit € 169,90 / credit € 117,30** — all reconciling three ways
(gross = net + vat = Σtotal = Σpayments).
