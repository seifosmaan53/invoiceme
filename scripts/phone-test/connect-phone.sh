#!/usr/bin/env bash
# Lets one USB-connected Android phone reach the phone-test backend:
# `adb reverse` maps the phone's own 127.0.0.1:3900 to this computer's
# 127.0.0.1:3900 over the USB cable. Nothing is opened on the network.
#   connect-phone.sh               the single USB phone
#   connect-phone.sh --disconnect  remove the mapping
# Network adb devices (serial host:port, e.g. a TV) are never used; with
# several USB phones set ANDROID_SERIAL=<serial from `adb devices`>.
set -euo pipefail
PORT=3900
command -v adb >/dev/null || { echo "adb not found (Android platform-tools)" >&2; exit 1; }

serial="${ANDROID_SERIAL:-}"
if [ -z "$serial" ]; then
  usb=$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1}')
  count=$(printf '%s\n' "$usb" | grep -c . || true)
  if [ "$count" -ne 1 ]; then
    echo "found $count authorised USB phone(s); connect exactly one (USB debugging on, allow this computer) or set ANDROID_SERIAL" >&2
    adb devices >&2
    exit 1
  fi
  serial="$usb"
fi
case "$serial" in *:*) echo "refusing network device $serial; use a USB phone" >&2; exit 1 ;; esac

if [ "${1:-}" = "--disconnect" ]; then
  adb -s "$serial" reverse --remove "tcp:$PORT" && echo "disconnected $serial"
  exit 0
fi
adb -s "$serial" reverse "tcp:$PORT" "tcp:$PORT"
adb -s "$serial" reverse --list | grep -q "tcp:$PORT" && echo "phone $serial -> this computer's 127.0.0.1:$PORT (USB)"
curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null && echo "backend reachable" \
  || echo "backend not running: scripts/phone-test/start.sh" >&2
