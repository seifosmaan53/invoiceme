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
#   schema-review.log      psql output while building the reference
#
# A person reads schema.diff and writes an installation-specific migration
# plan, then rehearses it on another restored copy before the maintenance
# window. Keep DB_SYNCHRONIZE disabled throughout.
set -euo pipefail
[ $# -eq 4 ] || { sed -n '2,25p' "$0"; exit 2; }
restored=$1; scratch=$2; migrations=$3; out=$4
mkdir -p "$out"

ref_db="invoiceme_schema_ref_$(date +%s)"
# Same server, credentials and query options (e.g. sslmode) as the scratch URL;
# only the database name changes. Requires a postgres:// URL with a database.
ref_url=$(node -e '
  const u = new URL(process.argv[1]);
  if (!/^postgres(ql)?:$/.test(u.protocol) || u.pathname.length < 2 || u.searchParams.has("dbname")) {
    console.error("scratch-server-url must be postgres://user@host:port/database[?options] (no dbname option)");
    process.exit(2);
  }
  u.pathname = "/" + process.argv[2];
  console.log(u.toString());' "$scratch" "$ref_db")
log="$out/schema-review.log"
: > "$log"
psql -v ON_ERROR_STOP=1 -q "$scratch" -c "CREATE DATABASE $ref_db" >>"$log" 2>&1 \
  || { echo "could not create the reference database (see $log)" >&2; exit 1; }
cleanup() { psql -q "$scratch" -c "DROP DATABASE IF EXISTS $ref_db" >>"$log" 2>&1 || true; }
trap cleanup EXIT

shopt -s nullglob
files=("$migrations"/[0-9][0-9][0-9]_*.sql)
[ ${#files[@]} -gt 0 ] || { echo "no migrations found in $migrations" >&2; exit 1; }
for f in "${files[@]}"; do   # glob order is sorted; paths may contain spaces
  echo "== $(basename "$f")" >>"$log"
  psql -v ON_ERROR_STOP=1 -q --single-transaction "$ref_url" -f "$f" >>"$log" 2>&1 \
    || { echo "reference build failed at $(basename "$f") (see $log)" >&2; exit 1; }
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
