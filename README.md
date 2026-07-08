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

All monetary values are handled through the `@calyx/money` value object
(integer-cents `Money`, parsed from DB decimals with `Money.fromDecimalString`) —
raw `number` arithmetic on currency is never used.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js |
| App framework | **SvelteKit** (standalone, Node adapter) — `+server.ts` routes are the backend, `+page.svelte` is the UI |
| Database access | **Kysely** (type-safe SQL query builder), **read-only** |
| Database | PostgreSQL (legacy Calyx POS schema) |
| Money | `@calyx/money` (vendored) + `decimal.js` |
| Rendering | HTML/CSS templates → **Puppeteer** (headless Chromium) → PDF |
| Printing | PDF → OS print queue (**CUPS**) for both 80mm and A4 |
| Testing | Vitest |

## Roadmap

Built in phases; each phase leaves something runnable and verifiable. **Presets
first** — the custom query builder comes after the end-to-end pipeline is proven.

- [x] **Foundation** — read-only DB role (`setup-readonly-role.sql`) and an
      isolated test database (see [`testdb/`](./testdb/README.md)) holding a copy
      of real legacy data.
- [ ] **Phase 0 — Scaffold & connection.** SvelteKit + Node adapter, vendored
      `@calyx/money`, Kysely `pg` pool on the read-only URL, hand-written types
      for the `pos.*` tables in use, and a health route that queries
      `pos.invoices` to prove the app→DB path.
- [ ] **Phase 1 — Aggregation engine.** Filters (`financial_date` range, exclude
      training/storno), fetch invoices + items, and compute totals / tax-by-rate /
      payment-by-column breakdowns through `Money`, with recursive multi-level
      grouping. Unit-tested against real rows.
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
