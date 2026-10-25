#!/usr/bin/env bash
# Builds a self-contained InvoiceMe backend update bundle for installations
# that run Node directly (no Docker). Run on a development machine from a
# clean checkout of the commit to ship:
#
#   scripts/make-update-bundle.sh [output-dir]
#
# The bundle contains the compiled backend (built exactly like the Docker
# builder stage: only src/, tsconfig.json and nest-cli.json, so the entry
# point is dist/main.js), package.json + package-lock.json, the SQL
# migrations, env.example, the operations and security docs, VERSION.txt and
# SHA256SUMS, healthcheck.js and scripts/schema-review.sh. It does NOT contain node_modules: bcrypt is a native module, so
# dependencies are installed on the target machine with
#   PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
# See docs/operations/customer-update.md.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to build: the working tree has uncommitted changes." >&2
  exit 2
fi
commit=$(git rev-parse HEAD)
short=$(git rev-parse --short=12 HEAD)
out_dir=${1:-"$repo_root/release"}
mkdir -p "$out_dir"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Only committed files.
git archive "$commit" backend docs/operations docs/security docs/SYNC-CONTRACT.md scripts/schema-review.sh | tar -x -C "$work"

# Builder stage (mirrors backend/Dockerfile).
build="$work/build"
mkdir -p "$build"
cp "$work/backend/package.json" "$work/backend/package-lock.json" "$work/backend/tsconfig.json" "$work/backend/nest-cli.json" "$build/"
cp -R "$work/backend/src" "$build/src"
(cd "$build" && PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)
test -f "$build/dist/main.js" || { echo "Build did not produce dist/main.js" >&2; exit 1; }

name="invoiceme-backend-$short"
bundle="$work/$name"
mkdir -p "$bundle/docs"
cp -R "$build/dist" "$bundle/dist"
cp "$work/backend/package.json" "$work/backend/package-lock.json" "$work/backend/env.example" "$work/backend/healthcheck.js" "$bundle/"
mkdir -p "$bundle/migrations"
cp "$work"/backend/migrations/*.sql "$bundle/migrations/"
cp -R "$work/docs/operations" "$work/docs/security" "$bundle/docs/"
cp "$work/docs/SYNC-CONTRACT.md" "$bundle/docs/"
mkdir -p "$bundle/scripts" && cp "$work/scripts/schema-review.sh" "$bundle/scripts/"
{
  echo "commit: $commit"
  echo "built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node (build): $(node --version)"
  echo "entry point: dist/main.js"
  echo "migrations: $(ls "$bundle/migrations" | tr '\n' ' ')"
} > "$bundle/VERSION.txt"
(cd "$bundle" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS)

tar -C "$work" -czf "$out_dir/$name.tar.gz" "$name"
(cd "$out_dir" && shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256")
echo "$out_dir/$name.tar.gz"
cat "$out_dir/$name.tar.gz.sha256"
