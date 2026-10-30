#!/usr/bin/env bash
# Verifies a built Android artifact (APK or AAB) and writes its release record.
# Used by .github/workflows/android-release.yml and android-test.yml
# (docs/release/ANDROID-RELEASE.md). Prints no secrets: it reads only the
# artifact, the merged manifest and public certificate data.
#
# Environment:
#   ARTIFACT               path to the .apk or .aab (required)
#   EXPECT_APP_ID          application id that must be in the artifact (required)
#   EXPECT_VERSION_NAME    versionName (required)
#   EXPECT_VERSION_CODE    versionCode (required)
#   EXPECT_CERT_SHA256     signing certificate SHA-256 the artifact must have (optional)
#   FORBID_CERT_SHA256     signing certificate SHA-256 it must not have (optional)
#   REQUIRE_DEBUG_CERT     true: must be signed by an "Android Debug" certificate
#   FORBID_DEBUG_CERT      true: must not be
#   FORBID_CLEARTEXT       true: the manifest must not allow cleartext HTTP
#   API_BASE_URL           recorded (and, with FORBID_CLEARTEXT, must be https://)
#   SOURCE_COMMIT          recorded
#   KIND                   recorded (production | test)
#   OUT_DIR                where the artifact copy, SHA256SUMS and record go (required)
#   ANDROID_HOME           Android SDK (build-tools for aapt/apksigner)
set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }
norm() { tr -d ': \r\n' | tr '[:upper:]' '[:lower:]'; }

: "${ARTIFACT:?}" "${EXPECT_APP_ID:?}" "${EXPECT_VERSION_NAME:?}" "${EXPECT_VERSION_CODE:?}" "${OUT_DIR:?}"
[ -f "$ARTIFACT" ] || fail "artifact not found: $ARTIFACT"
mkdir -p "$OUT_DIR"
bt="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"

case "$ARTIFACT" in
  *.apk)
    format=apk
    badging=$("$bt/aapt" dump badging "$ARTIFACT")
    pkg_line=$(echo "$badging" | grep -E "^package:")
    # Anchored: the line also has platformBuildVersionName='..' / platformBuildVersionCode='..'
    app_id=$(echo "$pkg_line" | sed -nE "s/^package: name='([^']+)'.*/\1/p")
    version_code=$(echo "$pkg_line" | sed -nE "s/.* versionCode='([^']+)'.*/\1/p")
    version_name=$(echo "$pkg_line" | sed -nE "s/.* versionName='([^']+)'.*/\1/p")
    label=$(echo "$badging" | sed -nE "s/^application-label:'(.*)'$/\1/p" | head -1)
    certs=$("$bt/apksigner" verify --print-certs "$ARTIFACT") || fail "apksigner: signature does not verify"
    # apksigner prints "Signer #1 certificate ..." or "V2 Signer: certificate ..." depending on version
    cert_dn=$(echo "$certs" | sed -nE 's/^(Signer #1|V[0-9]+ Signer:) certificate DN: (.*)$/\2/p' | head -1)
    cert_sha256=$(echo "$certs" | sed -nE 's/^(Signer #1|V[0-9]+ Signer:) certificate SHA-256 digest: (.*)$/\2/p' | head -1 | norm)
    # 0xffffffff = true in the compiled manifest. Output captured first: with
    # pipefail, grep -q closing the pipe early would make the pipeline fail.
    xmltree=$("$bt/aapt" dump xmltree "$ARTIFACT" AndroidManifest.xml)
    if grep -q "usesCleartextTraffic.*0xffffffff" <<<"$xmltree"; then
      cleartext=true
    else
      cleartext=false
    fi
    ;;
  *.aab)
    format=aab
    # Not -strict: Android signing certificates are self-signed, which -strict treats as an error
    verified=$(jarsigner -verify "$ARTIFACT" 2>&1 || true)
    grep -q "^jar verified" <<<"$verified" || fail "jarsigner: signature does not verify"
    printed=$(keytool -printcert -jarfile "$ARTIFACT")
    cert_dn=$(echo "$printed" | sed -nE 's/^Owner: (.*)$/\1/p' | head -1)
    cert_sha256=$(echo "$printed" | sed -nE 's/^[[:space:]]*SHA256: (.*)$/\1/p' | head -1 | norm)
    # The bundle's manifest is protobuf; read the merged release manifest Gradle wrote for it
    manifests=$(find "$(dirname "$ARTIFACT")/../../../intermediates" -path '*elease*' -name AndroidManifest.xml 2>/dev/null \
      | xargs grep -l "package=\"$EXPECT_APP_ID\"" 2>/dev/null || true)
    [ -n "$manifests" ] || fail "no merged release manifest for $EXPECT_APP_ID found next to the bundle"
    m=$(echo "$manifests" | head -1)
    # The bundle's own manifest (protobuf) must name the application id
    pb=$(mktemp)
    unzip -p "$ARTIFACT" base/manifest/AndroidManifest.xml > "$pb" || { rm -f "$pb"; fail "no base/manifest/AndroidManifest.xml in the bundle"; }
    # The id as a whole token: not followed by an identifier character or a
    # dot, so "<id>.synctest" or the "<id>.fileprovider" authority do not count
    if ! LC_ALL=C grep -aqP -- "\\Q${EXPECT_APP_ID}\\E(?![A-Za-z0-9_.])" "$pb"; then
      rm -f "$pb"; fail "the bundle's manifest does not contain the application id $EXPECT_APP_ID"
    fi
    rm -f "$pb"
    app_id=$EXPECT_APP_ID
    version_code=$(sed -nE 's/.*android:versionCode="([^"]+)".*/\1/p' "$m" | head -1)
    version_name=$(sed -nE 's/.*android:versionName="([^"]+)".*/\1/p' "$m" | head -1)
    label=$(sed -nE 's/.*android:label="([^"]+)".*/\1/p' "$m" | head -1)
    if echo "$manifests" | xargs grep -l 'usesCleartextTraffic="true"' > /dev/null 2>&1; then cleartext=true; else cleartext=false; fi
    ;;
  *) fail "unsupported artifact type: $ARTIFACT" ;;
esac

[ -n "$cert_sha256" ] || fail "could not read the signing certificate"
[ "$app_id" = "$EXPECT_APP_ID" ] || fail "application id is $app_id, expected $EXPECT_APP_ID"
[ "$version_name" = "$EXPECT_VERSION_NAME" ] || fail "versionName is $version_name, expected $EXPECT_VERSION_NAME"
[ "$version_code" = "$EXPECT_VERSION_CODE" ] || fail "versionCode is $version_code, expected $EXPECT_VERSION_CODE"
if [ -n "${EXPECT_CERT_SHA256:-}" ] && [ "$cert_sha256" != "$(echo "$EXPECT_CERT_SHA256" | norm)" ]; then
  fail "signed with certificate $cert_sha256, expected $(echo "$EXPECT_CERT_SHA256" | norm) (wrong key: refusing)"
fi
if [ -n "${FORBID_CERT_SHA256:-}" ] && [ "$cert_sha256" = "$(echo "$FORBID_CERT_SHA256" | norm)" ]; then
  fail "signed with a certificate this build must not use ($cert_sha256)"
fi
case "$cert_dn" in *"CN=Android Debug"*) debug_cert=true ;; *) debug_cert=false ;; esac
[ "${REQUIRE_DEBUG_CERT:-false}" != true ] || [ "$debug_cert" = true ] || fail "expected the Android debug certificate, got: $cert_dn"
[ "${FORBID_DEBUG_CERT:-false}" != true ] || [ "$debug_cert" = false ] || fail "signed with an Android debug certificate: not a release key"
if [ "${FORBID_CLEARTEXT:-false}" = true ]; then
  [ "$cleartext" = false ] || fail "the manifest allows cleartext HTTP (test-only setting) in a production build"
  case "${API_BASE_URL:-}" in https://*) ;; *) fail "API_BASE_URL must be an https:// URL in a production build" ;; esac
fi

name="invoiceme-${KIND:-build}-${version_name}-${version_code}-${SOURCE_COMMIT:0:7}.${format}"
cp "$ARTIFACT" "$OUT_DIR/$name"
(cd "$OUT_DIR" && sha256sum "$name" > SHA256SUMS)
artifact_sha256=$(cut -d' ' -f1 "$OUT_DIR/SHA256SUMS")
{
  echo "kind=${KIND:-unknown}"
  echo "artifact=$name"
  echo "artifact_sha256=$artifact_sha256"
  echo "format=$format"
  echo "application_id=$app_id"
  echo "label=$label"
  echo "version_name=$version_name"
  echo "version_code=$version_code"
  echo "signing_certificate_dn=$cert_dn"
  echo "signing_certificate_sha256=$cert_sha256"
  echo "debug_certificate=$debug_cert"
  echo "cleartext_http_allowed=$cleartext"
  echo "source_commit=${SOURCE_COMMIT:-unknown}"
  echo "api_base_url_scheme=$(echo "${API_BASE_URL:-default}" | sed -E 's#^([a-z]+)://.*#\1#')"
  echo "workflow_run=${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT_DIR/release-record.txt"
cat "$OUT_DIR/release-record.txt"
