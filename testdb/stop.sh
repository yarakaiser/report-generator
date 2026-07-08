#!/usr/bin/env bash
# Stop the isolated Calyx report-generator TEST database (port 5433).
set -euo pipefail

PGBIN=/usr/lib/postgresql/18/bin
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p 5433 >/dev/null 2>&1; then
  echo "Test DB not running."
  exit 0
fi

"$PGBIN/pg_ctl" -D "$HERE/pgdata" -w stop
echo "Test DB stopped."
