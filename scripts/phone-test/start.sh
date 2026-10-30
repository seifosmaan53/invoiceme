#!/usr/bin/env bash
# Isolated InvoiceMe test backend for physical-phone testing (synthetic data).
#
#   scripts/phone-test/start.sh     start (first run: create the database and seed accounts A and B)
#   scripts/phone-test/stop.sh      stop (data kept); stop.sh --wipe also deletes the test data
#
# - Its own PostgreSQL cluster in $INVOICEME_PHONE_TEST_HOME (default
#   ~/.invoiceme-phone-test), reachable only through a Unix socket in that
#   folder: no TCP port, no other database touched.
# - The backend listens on 127.0.0.1:3900 only (not the network). A phone
#   reaches it over USB with `adb reverse` (connect-phone.sh); nothing is
#   exposed on the LAN or the internet, and no firewall setting changes.
# - Started with an empty environment plus the values below: no SMTP (no
#   email is ever sent), no Stripe key (online payments disabled; no charge
#   is possible), no S3 (uploads disabled). No .env file is read.
# - Accounts A and B get random passwords, written to accounts.txt in the
#   state folder (mode 600). Synthetic, fictional data only.
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$REPO/backend"
PGDATA="$STATE/pgdata"
SOCK="$STATE/run"
LOG="$STATE/logs"
API="http://127.0.0.1:$PORT/api/v1"

for tool in initdb pg_ctl psql node npm curl openssl; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" = 20 ] || echo "note: Node $node_major (the release targets Node 20; fine for testing)"

umask 077
mkdir -p "$STATE" "$SOCK" "$LOG"

if [ -f "$STATE/backend.pid" ] && kill -0 "$(cat "$STATE/backend.pid")" 2>/dev/null; then
  echo "already running: $API (stop with scripts/phone-test/stop.sh)"
  exit 0
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is in use by another program; not starting" >&2
  exit 1
fi

# --- database (own cluster, socket only) ---
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" -U invoiceme_test --auth=trust --no-instructions >"$LOG/initdb.log"
  cat >>"$PGDATA/postgresql.conf" <<EOF
listen_addresses = ''
port = 5432
unix_socket_directories = '$SOCK'
unix_socket_permissions = 0700
EOF
fi
grep -q "^port = 5432" "$PGDATA/postgresql.conf" || echo "port = 5432" >>"$PGDATA/postgresql.conf"
if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -l "$LOG/postgres.log" -w start </dev/null >/dev/null 2>&1
fi
use_test_database
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='invoiceme_phone_test'" | grep -q 1 \
  || createdb invoiceme_phone_test

# --- secrets of this test backend (never reused elsewhere) ---
if [ ! -f "$STATE/secrets.env" ]; then
  {
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
  } >"$STATE/secrets.env"
fi
# shellcheck disable=SC1091
. "$STATE/secrets.env"

# --- backend build ---
if [ ! -d "$BACKEND/node_modules" ]; then
  (cd "$BACKEND" && PUPPETEER_SKIP_DOWNLOAD=true npm ci >"$LOG/npm-ci.log" 2>&1)
fi
(cd "$BACKEND" && npm run build >"$LOG/build.log" 2>&1) || { echo "backend build failed: $LOG/build.log" >&2; exit 1; }

chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$chrome" ] || chrome=""

# Run from the state folder (no .env there) with only these variables; the
# recorded pid is the node process itself.
(cd "$STATE" && exec env -i \
  PATH="$PATH" HOME="$HOME" TZ="${TZ:-UTC}" \
  NODE_ENV=test API_HOST=127.0.0.1 API_PORT=$PORT \
  JWT_SECRET="$JWT_SECRET" JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET" \
  DB_HOST="$SOCK" DB_PORT=5432 DB_USERNAME=invoiceme_test DB_PASSWORD= DB_DATABASE=invoiceme_phone_test \
  DB_SYNCHRONIZE=true \
  PUPPETEER_EXECUTABLE_PATH="$chrome" \
  node "$BACKEND/dist/main") </dev/null >"$LOG/backend.log" 2>&1 &
echo $! >"$STATE/backend.pid"
disown 2>/dev/null || true

for _ in $(seq 1 60); do
  curl -fsS "$API/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$API/health" >/dev/null || { echo "backend did not start: $LOG/backend.log" >&2; exit 1; }

# --- synthetic accounts and data (first start only) ---
if [ ! -f "$STATE/accounts.txt" ]; then
  "$REPO/scripts/phone-test/seed.sh" "$API" "$STATE"
fi

cat <<EOF
InvoiceMe phone-test backend running: $API (this computer only)
  accounts (synthetic): $STATE/accounts.txt
  logs:                 $LOG/backend.log
Connect a phone over USB: scripts/phone-test/connect-phone.sh
Stop:                     scripts/phone-test/stop.sh
EOF
