#!/usr/bin/env bash
# Acts as "the other device" for an account of the phone-test backend
# (conflict and deletion checks): signs in as A or B and makes one API call.
#   as-account.sh A GET /clients
#   as-account.sh A PATCH /clients/<id> '{"name":"Edited on the other device"}'
#   as-account.sh A DELETE /clients/<id>
# Prints the response; never prints the token or password.
set -euo pipefail
STATE="${INVOICEME_PHONE_TEST_HOME:-$HOME/.invoiceme-phone-test}"
API="http://127.0.0.1:3900/api/v1"
who="$1"; method="$2"; path="$3"; body="${4:-}"
case "$who" in A|B) ;; *) echo "account must be A or B" >&2; exit 1 ;; esac
# shellcheck disable=SC1091
. "$STATE/accounts.txt"
email_var="${who}_EMAIL"; pw_var="${who}_PASSWORD"
login=$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "${!email_var}" "${!pw_var}")
token=$(curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "$login" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).accessToken))')
curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' ${body:+-d "$body"}
echo
