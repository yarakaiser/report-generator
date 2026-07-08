#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Rebuild the TEST database from the dump (drops & reloads Earthrise_DB_test).
#
# Use when you want a clean copy again, or after refreshing Earthrise_DB.dump
# with a newer pg_dump of the source legacy DB. The cluster must be running
# (run ./start.sh first).
# ---------------------------------------------------------------------------
set -euo pipefail

PGBIN=/usr/lib/postgresql/18/bin
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=5433
SUPER=Earthrise_Server
DUMP="$HERE/Earthrise_DB.dump"

[ -f "$DUMP" ] || { echo "Dump not found: $DUMP"; exit 1; }
"$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 || { echo "Cluster not running; run ./start.sh"; exit 1; }

echo "Dropping and recreating Earthrise_DB_test..."
psql -h 127.0.0.1 -p "$PORT" -U "$SUPER" -d postgres -q \
  -c 'DROP DATABASE IF EXISTS "Earthrise_DB_test";' \
  -c 'CREATE DATABASE "Earthrise_DB_test" OWNER "'"$SUPER"'";'

echo "Restoring dump (ignoring source tablespaces/owners)..."
"$PGBIN/pg_restore" -h 127.0.0.1 -p "$PORT" -U "$SUPER" -d Earthrise_DB_test \
  --no-owner --no-tablespaces --no-privileges "$DUMP" 2>/dev/null || true

echo "Applying read-only role..."
psql -h 127.0.0.1 -p "$PORT" -U "$SUPER" -d Earthrise_DB_test -q \
  -v ro_user=calyx_readonly -v ro_password=readonly_test -v db_name=Earthrise_DB_test \
  -f "$HERE/../setup-readonly-role.sql"

echo "Done. Verify:"
psql "postgresql://calyx_readonly:readonly_test@127.0.0.1:$PORT/Earthrise_DB_test" \
  -tAc "SELECT 'invoices='||count(*)||', total='||sum(total) FROM pos.invoices;"
