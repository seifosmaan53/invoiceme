#!/usr/bin/env bash
# Stops the phone-test backend and its database; the test data is kept.
#   stop.sh          stop
#   stop.sh --wipe   stop and delete the whole test folder (synthetic data only)
set -euo pipefail
STATE="${INVOICEME_PHONE_TEST_HOME:-$HOME/.invoiceme-phone-test}"

if [ -f "$STATE/backend.pid" ]; then
  pid=$(cat "$STATE/backend.pid")
  if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -q "backend/dist/main"; then
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  fi
  rm -f "$STATE/backend.pid"
fi
if [ -f "$STATE/pgdata/PG_VERSION" ] && pg_ctl -D "$STATE/pgdata" status >/dev/null 2>&1; then
  pg_ctl -D "$STATE/pgdata" -m fast -w stop >/dev/null
fi
echo "stopped"

if [ "${1:-}" = "--wipe" ]; then
  case "$STATE" in
    */.invoiceme-phone-test|*invoiceme-phone-test*) rm -rf "$STATE"; echo "deleted $STATE" ;;
    *) echo "refusing to delete $STATE (not an invoiceme-phone-test folder)" >&2; exit 1 ;;
  esac
fi
