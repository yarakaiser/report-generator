#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Start the isolated Calyx report-generator TEST database.
#
# A native PostgreSQL 18 cluster (its own data dir, port 5433) holding a copy
# of the legacy Earthrise_DB. Completely separate from the host's 5432 cluster
# that holds the real data. Safe to start/stop/drop at will.
# ---------------------------------------------------------------------------
set -euo pipefail

PGBIN=/usr/lib/postgresql/18/bin
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGDATA="$HERE/pgdata"
PORT=5433

if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  echo "Test DB already running on :$PORT"
  exit 0
fi

# -k $HERE -> put the unix socket in this folder (default /var/run/postgresql is not writable)
"$PGBIN/pg_ctl" -D "$PGDATA" -l "$HERE/pg.log" -o "-p $PORT -k $HERE" -w start
echo "Test DB started on 127.0.0.1:$PORT"
echo "  read-only URL: postgresql://calyx_readonly:readonly_test@127.0.0.1:$PORT/Earthrise_DB_test"
