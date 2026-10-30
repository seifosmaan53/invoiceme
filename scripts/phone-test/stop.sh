#!/usr/bin/env bash
# Stops the phone-test backend and its database; the test data is kept.
#   stop.sh          stop
#   stop.sh --wipe   stop and delete the test folder (synthetic data only)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

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
  [ -d "$STATE" ] || { echo "nothing to delete"; exit 0; }
  real=$(cd "$STATE" && pwd -P)
  # Only a folder this tooling created: a plain name ending in
  # invoiceme-phone-test, not the home folder or /, with its marker files.
  case "$(basename "$real")" in
    .invoiceme-phone-test|invoiceme-phone-test) ;;
    *) echo "refusing to delete $real (not an invoiceme-phone-test folder)" >&2; exit 1 ;;
  esac
  if [ "$real" = "$(cd "$HOME" && pwd -P)" ] || [ "$real" = / ] \
     || [ ! -f "$real/secrets.env" ] || [ ! -f "$real/pgdata/PG_VERSION" ]; then
    echo "refusing to delete $real (not a phone-test folder created by start.sh)" >&2
    exit 1
  fi
  rm -rf "$real"
  echo "deleted $real"
fi
