# Shared helpers of the phone-test scripts (sourced, not run).

STATE="${INVOICEME_PHONE_TEST_HOME:-$HOME/.invoiceme-phone-test}"
PORT=3900

# Serials of authorised phones attached by USB cable. Devices reached over
# the network (classic `host:port` or wireless debugging `..._tcp`) are
# never returned, whatever they are.
usb_phones() {
  adb devices -l | awk 'NR>1 && $2=="device" && / usb:/ && $1 !~ /:/ && $1 !~ /_tcp/ {print $1}'
}

# The one USB phone to use (ANDROID_SERIAL must name a USB phone), or exits.
pick_usb_phone() {
  command -v adb >/dev/null || { echo "adb not found (Android platform-tools)" >&2; exit 1; }
  local phones count
  phones=$(usb_phones)
  if [ -n "${ANDROID_SERIAL:-}" ]; then
    printf '%s\n' "$phones" | grep -Fqx -- "$ANDROID_SERIAL" \
      || { echo "ANDROID_SERIAL=$ANDROID_SERIAL is not an authorised USB phone" >&2; exit 1; }
    echo "$ANDROID_SERIAL"
    return
  fi
  count=$(printf '%s\n' "$phones" | grep -c . || true)
  if [ "$count" -ne 1 ]; then
    echo "found $count authorised USB phone(s); connect exactly one (USB debugging on, allow this computer) or set ANDROID_SERIAL" >&2
    exit 1
  fi
  echo "$phones"
}

# The test cluster's own connection (never the computer's other PostgreSQL).
use_test_database() {
  export PGHOST="$STATE/run" PGPORT=5432 PGUSER=invoiceme_test PGDATABASE=invoiceme_phone_test
}
