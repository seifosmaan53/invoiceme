#!/usr/bin/env bash
# Lets one USB-connected Android phone reach the phone-test backend:
# `adb reverse` maps the phone's own 127.0.0.1:3900 to this computer's
# 127.0.0.1:3900 over the USB cable. Nothing is opened on the network.
#   connect-phone.sh               the single USB phone
#   connect-phone.sh --disconnect  remove the mapping
# Only phones attached by USB cable are used (never network or wireless adb
# devices, e.g. a TV); with several USB phones set ANDROID_SERIAL.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
serial=$(pick_usb_phone)

if [ "${1:-}" = "--disconnect" ]; then
  adb -s "$serial" reverse --remove "tcp:$PORT" && echo "disconnected $serial"
  exit 0
fi
adb -s "$serial" reverse "tcp:$PORT" "tcp:$PORT"
adb -s "$serial" reverse --list | grep -q "tcp:$PORT" \
  || { echo "the mapping was not created on $serial" >&2; exit 1; }
echo "phone $serial -> this computer's 127.0.0.1:$PORT (USB)"
if curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null; then
  echo "backend reachable"
else
  echo "backend not running: scripts/phone-test/start.sh" >&2
  exit 1
fi
