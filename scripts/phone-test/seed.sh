#!/usr/bin/env bash
# Seeds the phone-test backend (start.sh calls it on the first start):
# synthetic accounts A and B with fictional clients and invoices; for A a
# paid invoice with a synthetic partial refund (written to the test database,
# no payment provider involved) and two attachment records (a normal link and
# an unsafe javascript: link the app must not open).
# Usage: seed.sh <api> <state-dir>
set -euo pipefail
API="$1"
STATE="$2"
run="$(date +%s)"

json() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const v=JSON.parse(d);let x=v;for(const p of process.argv[1].split("."))x=x?.[p];if(x==null){console.error("missing "+process.argv[1]);process.exit(1)}console.log(x)})' "$1"; }

register() { # email password name -> access token
  curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"name\":\"$3\"}" | json accessToken
}
call() { # token method path [body]
  curl -fsS -X "$2" "$API$3" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' ${4:+-d "$4"}
}
invoice() { # token client status number-suffix amount
  call "$1" POST /invoices "{\"clientId\":\"$2\",\"status\":\"$3\",\"issueDate\":\"2026-10-01\",\"dueDate\":\"2026-10-15\",\"currency\":\"USD\",\"notes\":\"Synthetic test invoice\",\"items\":[{\"description\":\"Fictional service $4\",\"quantity\":1,\"unitPrice\":$5}]}" | json id
}

pw_a="Test-A-$(openssl rand -hex 8)"
pw_b="Test-B-$(openssl rand -hex 8)"
email_a="phone-test-a-$run@example.test"
email_b="phone-test-b-$run@example.test"

ta=$(register "$email_a" "$pw_a" "Test Account A")
tb=$(register "$email_b" "$pw_b" "Test Account B")

ca=$(call "$ta" POST /clients '{"name":"Northwind Test Co (A)","email":"billing@northwind.example.test"}' | json id)
ca2=$(call "$ta" POST /clients '{"name":"Delete-me Test Client (A)"}' | json id)
invoice "$ta" "$ca" draft A-1 120 >/dev/null
invoice "$ta" "$ca" sent A-2 250 >/dev/null
paid=$(invoice "$ta" "$ca" paid A-3 100)
status=$(call "$ta" GET "/invoices/$paid" | json status)
[ "$status" = paid ] || call "$ta" PATCH "/invoices/$paid" '{"status":"paid"}' >/dev/null

cb=$(call "$tb" POST /clients '{"name":"Contoso Test Ltd (B)"}' | json id)
invoice "$tb" "$cb" sent B-1 75 >/dev/null

psql -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO payments (id, invoice_id, provider, provider_payment_id, amount, currency, status, refunded_amount, disputed_amount, created_at, updated_at)
  VALUES (gen_random_uuid(), '$paid', 'other', 'synthetic-$run', 100.00, 'USD', 'completed', 30.00, 0, now(), now());
INSERT INTO attachments (id, owner_type, owner_id, url, filename, content_type, size_bytes, created_at)
  VALUES (gen_random_uuid(), 'invoice', '$paid', 'https://example.com/', 'normal-link.pdf', 'application/pdf', 1024, now()),
         (gen_random_uuid(), 'invoice', '$paid', 'javascript:alert(1)', 'unsafe-link.pdf', 'application/pdf', 1024, now());
SQL

cat >"$STATE/accounts.txt" <<EOF
# Synthetic accounts of the InvoiceMe phone-test backend (test data only).
A_EMAIL=$email_a
A_PASSWORD=$pw_a
B_EMAIL=$email_b
B_PASSWORD=$pw_b
# A: clients "Northwind Test Co (A)" and "Delete-me Test Client (A)"; invoices: draft \$120, sent \$250,
#    paid \$100 with a synthetic partial refund (\$30) and two attachments (a normal and an unsafe link).
# B: client "Contoso Test Ltd (B)"; invoice: sent \$75.
A_PAID_INVOICE_ID=$paid
A_DELETE_ME_CLIENT_ID=$ca2
EOF
chmod 600 "$STATE/accounts.txt"
echo "seeded synthetic accounts A and B"
