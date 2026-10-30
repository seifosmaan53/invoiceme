#!/usr/bin/env bash
# Runs the on-device sync tests (mobile/integration_test/android_sync_test.dart,
# the same flows as the CI emulator job) on the USB-connected phone, against
# the phone-test backend: native SQLite migration, a queued change and a
# conflict resolved in the conflict screen, account switching between
# synthetic accounts A and B, and the payment card.
#
# Needs the Flutter SDK on this computer. `flutter test` builds and installs
# a separate debug test app (package com.example.invoiceme, debug key of this
# computer) on the phone: use the spare test phone only, without another app
# of that package. The payment check reopens A's paid invoice: before running
# it again, reset the test data (stop.sh --wipe && start.sh).
set -euo pipefail
STATE="${INVOICEME_PHONE_TEST_HOME:-$HOME/.invoiceme-phone-test}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
command -v flutter >/dev/null || { echo "flutter not found (Flutter SDK)" >&2; exit 1; }
[ -f "$STATE/accounts.txt" ] || { echo "start the backend first: scripts/phone-test/start.sh" >&2; exit 1; }

"$REPO/scripts/phone-test/connect-phone.sh"
serial="${ANDROID_SERIAL:-$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1; exit}')}"
if adb -s "$serial" shell pm list packages | tr -d '\r' | grep -qx "package:com.example.invoiceme"; then
  echo "the phone already has an app com.example.invoiceme; not installing a test app over it" >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$STATE/accounts.txt"
cd "$REPO/mobile"
flutter test integration_test/android_sync_test.dart -d "$serial" --reporter expanded \
  --dart-define=E2E_API=http://127.0.0.1:3900/api/v1 \
  --dart-define=E2E_EMAIL="$A_EMAIL" --dart-define=E2E_PASSWORD="$A_PASSWORD" \
  --dart-define=E2E_EMAIL_B="$B_EMAIL" --dart-define=E2E_PASSWORD_B="$B_PASSWORD" \
  --dart-define=E2E_PAID_INVOICE_ID="$A_PAID_INVOICE_ID"
