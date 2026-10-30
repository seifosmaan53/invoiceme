#!/usr/bin/env bash
# Synthetic test data for the Android sync test (android_sync_test.dart).
# Creates two fresh users through the API (A with a paid invoice, B with a
# client), and for A one synthetic
# completed payment with a partial refund written straight to PostgreSQL
# (no payment provider is called). Prints KEY=VALUE lines for --dart-define.
#
# Env: API (default http://localhost:3000/api/v1), PGHOST, PGPORT, PGUSER,
# PGPASSWORD, PGDATABASE (psql connection to the backend's database).
set -euo pipefail
API="${API:-http://localhost:3000/api/v1}"
run_id="$(date +%s)-$RANDOM"
email="sync-e2e-${run_id}@example.test"
password="E2e-Passw0rd-${run_id}"

json() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const v=JSON.parse(d);const k=process.argv[1].split(".");let x=v;for(const p of k)x=x?.[p];if(x===undefined||x===null){console.error("missing "+process.argv[1]+" in "+d);process.exit(1)}console.log(x)})' "$1"; }

token=$(curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"Sync E2E\"}" | json accessToken)
auth=(-H "Authorization: Bearer $token" -H 'Content-Type: application/json')

client_id=$(curl -fsS -X POST "$API/clients" "${auth[@]}" -d '{"name":"Synthetic Payment Client"}' | json id)
invoice_json=$(curl -fsS -X POST "$API/invoices" "${auth[@]}" -d "{\"clientId\":\"$client_id\",\"status\":\"paid\",\"issueDate\":\"2026-10-01\",\"currency\":\"USD\",\"items\":[{\"description\":\"Synthetic work\",\"quantity\":1,\"unitPrice\":100}]}")
invoice_id=$(echo "$invoice_json" | json id)
status=$(echo "$invoice_json" | json status)
if [ "$status" != "paid" ]; then
  curl -fsS -X PATCH "$API/invoices/$invoice_id" "${auth[@]}" -d '{"status":"paid"}' > /dev/null
fi

psql -v ON_ERROR_STOP=1 -q -c "INSERT INTO payments (id, invoice_id, provider, provider_payment_id, amount, currency, status, refunded_amount, disputed_amount, created_at, updated_at)
  VALUES (gen_random_uuid(), '$invoice_id', 'other', 'synthetic-$run_id', 100.00, 'USD', 'completed', 30.00, 0, now(), now())"

summary=$(curl -fsS "$API/invoices/$invoice_id" "${auth[@]}" | json paymentSummary.state)
if [ "$summary" != "partially_refunded" ]; then
  echo "unexpected payment state: $summary" >&2
  exit 1
fi

# Second synthetic account with its own client (account switching test).
email_b="sync-e2e-b-${run_id}@example.test"
password_b="E2e-Passw0rd-b-${run_id}"
token_b=$(curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email_b\",\"password\":\"$password_b\",\"name\":\"Sync E2E B\"}" | json accessToken)
curl -fsS -X POST "$API/clients" -H "Authorization: Bearer $token_b" -H 'Content-Type: application/json' \
  -d '{"name":"Synthetic B Client"}' > /dev/null

echo "E2E_EMAIL=$email"
echo "E2E_PASSWORD=$password"
echo "E2E_PAID_INVOICE_ID=$invoice_id"
echo "E2E_EMAIL_B=$email_b"
echo "E2E_PASSWORD_B=$password_b"
