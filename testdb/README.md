# Test Database

An **isolated, disposable** copy of the legacy Calyx POS database (`Earthrise_DB`)
for developing and verifying the report generator against real data — without any
risk to the source.

## What it is

- A native **PostgreSQL 18** cluster living entirely in `testdb/pgdata/`.
- Runs on **port 5433** (the host's real cluster owns 5432 — this never touches it).
- Database name: **`Earthrise_DB_test`** — a full copy of the source, restored via
  `pg_restore --no-tablespaces` (the source uses custom tablespaces that don't exist here).
- Contains the real legacy schemas: `pos`, `posreporting`, `poslog`, `partitions`, etc.

## Connection strings

| Role | URL | Use |
| --- | --- | --- |
| **read-only** (the tool uses this) | `postgresql://calyx_readonly:readonly_test@127.0.0.1:5433/Earthrise_DB_test` | app / reports |
| superuser (admin only) | `postgresql://Earthrise_Server@127.0.0.1:5433/Earthrise_DB_test` | rebuild / inspect |

The `calyx_readonly` role has `SELECT`-only privileges **and** `default_transaction_read_only = on`
— any write is refused at two layers. See `../setup-readonly-role.sql`.

## Usage

```bash
./start.sh      # start the cluster (needed once per session / after reboot)
./stop.sh       # stop it
./rebuild.sh    # drop + reload from Earthrise_DB.dump, re-apply read-only role
```

## Refreshing the data

To pull a newer snapshot from the source legacy DB (on the host's 5432 cluster):

```bash
PGPASSWORD=... pg_dump -h localhost -p 5432 -U Earthrise_Server -Fc \
  -f testdb/Earthrise_DB.dump Earthrise_DB
./rebuild.sh
```

## Notes

- `pgdata/`, `pg.log`, the unix socket, and `*.dump` are **git-ignored** — never committed.
- Extensions (including the custom `pg_pagecamel_license`) resolve because this cluster
  uses the same PG18 installation as the source.
