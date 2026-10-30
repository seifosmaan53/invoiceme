#!/usr/bin/env bash
# Collects diagnostics from a phone test without tokens, passwords or
# e-mail addresses: the test app's own log lines (logcat of its running
# process) and the test backend's log, with secrets masked.
#   collect-logs.sh [output-folder]   (default: ~/.invoiceme-phone-test/diagnostics-<time>)
# Review the files before sharing them.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
APP=com.example.invoiceme.synctest
out="${1:-$STATE/diagnostics-$(date +%Y%m%d-%H%M%S)}"
umask 077
mkdir -p "$out"

redact() {
  sed -E \
    -e 's/([Bb][Ee][Aa][Rr][Ee][Rr] )[A-Za-z0-9._~+\/=-]+/\1[TOKEN]/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/[JWT]/g' \
    -e 's/("?(password|refreshToken|accessToken|token|secret|client_secret)"?[:=] *"?)[^",}]+/\1[REDACTED]/Ig' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[EMAIL]/g'
}

if command -v adb >/dev/null && serial=$(pick_usb_phone 2>/dev/null); then
  pid=$(adb -s "$serial" shell pidof "$APP" 2>/dev/null | tr -d '\r' | awk '{print $1}' || true)
  if [ -n "$pid" ]; then
    adb -s "$serial" logcat -d --pid="$pid" | redact >"$out/app-logcat.txt" || true
  else
    echo "the app is not running: open it, reproduce, then run this again" >"$out/app-logcat.txt"
  fi
  {
    echo "model: $(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
    echo "android: $(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
    adb -s "$serial" shell dumpsys package "$APP" | tr -d '\r' | grep -E "versionName|versionCode|lastUpdateTime" || echo "app not installed"
  } >"$out/device.txt" || true
else
  echo "no USB phone connected: phone logs skipped" >&2
fi
if [ -f "$STATE/logs/backend.log" ]; then
  tail -n 2000 "$STATE/logs/backend.log" | redact >"$out/backend.txt" || true
fi
echo "written to $out (review before sharing)"
