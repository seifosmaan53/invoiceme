#!/usr/bin/env bash
# Collects diagnostics from a phone test without tokens, passwords or
# record contents: the test app's own log lines (logcat, filtered to its
# process) and the test backend's log, with secrets and personal data masked.
#   collect-logs.sh [output-folder]   (default: ./invoiceme-phone-logs-<time>)
# Review the files before sharing them.
set -euo pipefail
STATE="${INVOICEME_PHONE_TEST_HOME:-$HOME/.invoiceme-phone-test}"
APP=com.example.invoiceme.synctest
out="${1:-./invoiceme-phone-logs-$(date +%Y%m%d-%H%M%S)}"
umask 077
mkdir -p "$out"

redact() {
  sed -E \
    -e 's/(Bearer )[A-Za-z0-9._~+\/=-]+/\1[TOKEN]/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/[JWT]/g' \
    -e 's/("?(password|refreshToken|accessToken|token|secret|client_secret)"?[:=] *"?)[^",} ]+/\1[REDACTED]/Ig' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[EMAIL]/g'
}

if command -v adb >/dev/null; then
  serial="${ANDROID_SERIAL:-$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1; exit}')}"
  if [ -n "$serial" ]; then
    pid=$(adb -s "$serial" shell pidof "$APP" 2>/dev/null | tr -d '\r' || true)
    if [ -n "$pid" ]; then
      adb -s "$serial" logcat -d --pid="$pid" | redact >"$out/app-logcat.txt"
    else
      adb -s "$serial" logcat -d -s flutter:V | redact >"$out/app-logcat.txt"
    fi
    {
      echo "model: $(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
      echo "android: $(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
      adb -s "$serial" shell dumpsys package "$APP" | grep -E "versionName|versionCode|lastUpdateTime" | tr -d '\r'
    } >"$out/device.txt"
  fi
fi
[ -f "$STATE/logs/backend.log" ] && tail -n 2000 "$STATE/logs/backend.log" | redact >"$out/backend.txt"
echo "written to $out (review before sharing)"
