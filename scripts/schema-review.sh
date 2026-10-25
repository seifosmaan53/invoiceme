#!/usr/bin/env bash
# Produces the evidence for a schema compatibility review. It does not decide
# anything and never connects to the live installation: run it against the
# VERIFIED RESTORE of the customer's backup, on the operator's machine.
#
#   scripts/schema-review.sh <restored-db-url> <scratch-server-url> <migrations-dir> <out-dir>
#
#   restored-db-url     postgres:// URL of the restored copy (read only is enough)
#   scratch-server-url  postgres:// URL of a server where a temporary database may
#                       be created and dropped (e.g. postgres://me@localhost:5432/postgres)
#   migrations-dir      the release's migrations/ folder (from the update bundle)
#   out-dir             where to write the evidence
#
# Writes, in out-dir:
#   installed.schema.sql   pg_dump --schema-only of the restored copy
#   reference.schema.sql   pg_dump --schema-only of a scratch database built from
#                          migrations 001-017 of this release
#   schema.diff            normalised diff (comments, SET lines, owners and
#                          privileges removed) between the two
#
# A person reads schema.diff and writes an installation-specific migration
# plan, then rehearses it on another restored copy before the maintenance
# window. Keep DB_SYNCHRONIZE disabled throughout.
set -euo pipefail
[ $# -eq 4 ] || { sed -n '2,25p' "$0"; exit 2; }
restored=$1; scratch=$2; migrations=$3; out=$4
mkdir -p "$out"

ref_db="invoiceme_schema_ref_$(date +%s)"
psql -v ON_ERROR_STOP=1 -q "$scratch" -c "CREATE DATABASE $ref_db" >/dev/null
ref_url="${scratch%/*}/$ref_db"
cleanup() { psql -q "$scratch" -c "DROP DATABASE IF EXISTS $ref_db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for f in $(ls "$migrations"/[0-9][0-9][0-9]_*.sql | sort); do
  psql -v ON_ERROR_STOP=1 -q --single-transaction "$ref_url" -f "$f" >/dev/null 2>&1 \
    || { echo "reference build failed at $(basename "$f")" >&2; exit 1; }
done

dump() { pg_dump --schema-only --no-owner --no-privileges --schema=public "$1"; }
dump "$restored" > "$out/installed.schema.sql"
dump "$ref_url" > "$out/reference.schema.sql"

normalise() { grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' "$1" | sed '/^$/d'; }
if diff -u <(normalise "$out/reference.schema.sql") <(normalise "$out/installed.schema.sql") \
     --label reference --label installed > "$out/schema.diff"; then
  echo "No schema differences from the reference (still review installed.schema.sql for extra objects such as views or triggers)."
else
  echo "Schema differences written to $out/schema.diff ($(grep -c '^[-+][^-+]' "$out/schema.diff") changed lines). Review before planning any migration."
fi
