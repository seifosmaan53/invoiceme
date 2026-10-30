#!/usr/bin/env bash
# Runs the on-device sync tests (mobile/integration_test/android_sync_test.dart,
# the test code of the CI emulator job) on the USB-connected phone, against
# the phone-test backend: native SQLite migration, a queued change and a
# conflict resolved in the conflict screen, account switching between
# synthetic accounts A and B, and the payment card.
#
# Needs the Flutter SDK. `flutter test` builds and installs a separate debug
# test app, package com.example.invoiceme (debug key of this computer; CI
# builds the same tests as the .synctest variant): it never touches the
# installed "InvoiceMe (sync test)" phone build. The synthetic A/B passwords
# are compiled into that debug test app; it holds only test data, and you may
# remove it afterwards (`adb -d uninstall com.example.invoiceme`). The payment
# check reopens A's paid invoice: reset the test data (stop.sh --wipe &&
# start.sh) before running it again.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
command -v flutter >/dev/null || { echo "flutter not found (Flutter SDK)" >&2; exit 1; }
[ -f "$STATE/accounts.txt" ] || { echo "start the backend first: scripts/phone-test/start.sh" >&2; exit 1; }

"$REPO/scripts/phone-test/connect-phone.sh"
serial=$(pick_usb_phone)
if adb -s "$serial" shell pm list packages | tr -d '\r' | grep -qx "package:com.example.invoiceme"; then
  echo "the phone already has an app com.example.invoiceme; not installing a test app over it" >&2
  exit 1
fi
if grep -qsE "^\s*invoicemeTestBuild|^\s*invoicemeApplicationId" "${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"; then
  echo "invoicemeTestBuild/invoicemeApplicationId is set in your Gradle user properties; remove it for this run" >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$STATE/accounts.txt"
cd "$REPO/mobile"
# Never the test-build variant or another id here (they would replace an installed app).
env -u ORG_GRADLE_PROJECT_invoicemeTestBuild -u ORG_GRADLE_PROJECT_invoicemeApplicationId \
  flutter test integration_test/android_sync_test.dart -d "$serial" --reporter expanded \
  --dart-define=E2E_API=http://127.0.0.1:3900/api/v1 \
  --dart-define=E2E_EMAIL="$A_EMAIL" --dart-define=E2E_PASSWORD="$A_PASSWORD" \
  --dart-define=E2E_EMAIL_B="$B_EMAIL" --dart-define=E2E_PASSWORD_B="$B_PASSWORD" \
  --dart-define=E2E_PAID_INVOICE_ID="$A_PAID_INVOICE_ID"
