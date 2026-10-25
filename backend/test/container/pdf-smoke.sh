#!/usr/bin/env bash
# Container smoke test: renders a synthetic invoice PDF inside the built
# backend image through the application's real PdfService and PdfCacheService,
# then validates both PDFs on the host.
#
# Usage: backend/test/container/pdf-smoke.sh [image]   (default invoiceme-backend:ci)
# Needs: docker, node, pdfinfo + pdftotext (poppler-utils). qpdf is used if present.
set -euo pipefail

IMAGE="${1:-invoiceme-backend:ci}"
INVOICE_NUMBER="SMOKE-INV-$(date +%s)"
RUN_TIMEOUT="${SMOKE_RUN_TIMEOUT:-180}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

for tool in docker node pdfinfo pdftotext; do
  command -v "$tool" >/dev/null || fail "missing required tool: $tool"
done

image_user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
[ -n "$image_user" ] && [ "$image_user" != "root" ] && [ "$image_user" != "0" ] \
  || fail "image runs as root (Config.User='$image_user')"
echo "image user: $image_user"

# No network: the render must not depend on anything outside the container.
# The image's own user and entrypoint are kept; only the command is replaced.
echo "rendering synthetic invoice $INVOICE_NUMBER in $IMAGE (timeout ${RUN_TIMEOUT}s)"
if ! timeout "$RUN_TIMEOUT" docker run --rm -i --network none \
      -e SMOKE_INVOICE_NUMBER="$INVOICE_NUMBER" \
      "$IMAGE" node - < "$HERE/pdf-smoke.js" > "$WORK/result.json" 2> "$WORK/stderr.log"; then
  cat "$WORK/stderr.log" >&2
  fail "container render failed or timed out"
fi

node -e '
const fs = require("fs");
const [file, dir] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(file, "utf8").trim());
fs.writeFileSync(dir + "/service.pdf", Buffer.from(r.servicePdf, "base64"));
fs.writeFileSync(dir + "/cache.pdf", Buffer.from(r.cachePdf, "base64"));
delete r.servicePdf; delete r.cachePdf;
fs.writeFileSync(dir + "/meta.json", JSON.stringify(r));
console.log(JSON.stringify(r, null, 2));
' "$WORK/result.json" "$WORK"

meta() { node -e 'const m=require(process.argv[1]); process.stdout.write(String(m[process.argv[2]] ?? ""))' "$WORK/meta.json" "$1"; }

uid="$(meta uid)"
[ "$uid" != "0" ] || fail "render ran as uid 0"
exe="$(meta executablePathEnv)"
[ -n "$exe" ] || fail "PUPPETEER_EXECUTABLE_PATH is not set in the image"
[ "$(meta cacheExecutable)" = "$exe" ] || fail "PdfCacheService launched $(meta cacheExecutable), expected $exe"
grep -qF "Using Chrome executable: $exe" "$WORK/stderr.log" \
  || { cat "$WORK/stderr.log" >&2; fail "PdfService did not launch $exe"; }

for name in service cache; do
  pdf="$WORK/$name.pdf"
  size="$(wc -c < "$pdf")"
  [ "$(head -c 5 "$pdf")" = "%PDF-" ] || fail "$name.pdf does not start with %PDF-"
  tail -c 32 "$pdf" | grep -q '%%EOF' || fail "$name.pdf does not end with %%EOF"
  pdfinfo "$pdf" > "$WORK/$name.info" || fail "pdfinfo cannot parse $name.pdf"
  pages="$(awk '/^Pages:/ {print $2}' "$WORK/$name.info")"
  [ "${pages:-0}" -ge 1 ] || fail "$name.pdf has no pages"
  if command -v qpdf >/dev/null; then
    qpdf --check "$pdf" > /dev/null || fail "qpdf --check failed for $name.pdf"
  fi
  pdftotext "$pdf" - | grep -qF "$INVOICE_NUMBER" || fail "$name.pdf does not contain $INVOICE_NUMBER"
  echo "OK $name.pdf: $size bytes, $pages page(s), producer: $(awk -F': *' '/^Producer:/ {print $2}' "$WORK/$name.info"), contains $INVOICE_NUMBER"
done

echo "SMOKE PASS: $(meta browserVersion) via $exe as uid $uid (puppeteer $(meta puppeteer), node $(meta node))"
