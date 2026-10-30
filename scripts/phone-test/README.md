# Phone-test backend (synthetic data, this computer only)

An isolated InvoiceMe backend for testing the `.synctest` app on a physical
Android phone (docs/release/DEVICE-ACCEPTANCE.md). macOS or Linux with
PostgreSQL client and server tools (`initdb`, `pg_ctl`, `psql`), Node.js and
npm; `adb` for the phone; Google Chrome for invoice PDFs (macOS path
detected; without it the PDF check fails).

| Command | Does |
|---|---|
| `scripts/phone-test/start.sh` | Starts it; the first start creates the database and seeds accounts A and B |
| `scripts/phone-test/stop.sh` | Stops it (data kept) |
| `scripts/phone-test/stop.sh --wipe` | Stops it and deletes all its test data, including saved diagnostics (copy those elsewhere first) |
| `scripts/phone-test/connect-phone.sh` | Connects the single USB phone (`--disconnect` removes it) |
| `scripts/phone-test/as-account.sh A\|B METHOD PATH [JSON]` | One API call as A or B ("the other device") |
| `scripts/phone-test/run-device-tests.sh` | On-device sync tests on the phone (needs Flutter) |
| `scripts/phone-test/collect-logs.sh` | Diagnostics with tokens, passwords and e-mails masked |

## Isolation

- **Storage:** its own PostgreSQL cluster and files in
  `~/.invoiceme-phone-test` (`INVOICEME_PHONE_TEST_HOME` to change). The
  database has no TCP port, only a Unix socket in that folder; no other
  database on the computer is used.
- **Network:** the backend listens on `127.0.0.1:3900` only. Nothing is
  exposed on the LAN or the internet, and no firewall or router setting is
  changed.
- **No real money, no real e-mail:** it starts with an empty environment
  (no `.env` read): no SMTP (e-mail sending is disabled; the log says so),
  no Stripe key (online payments are disabled; nothing can be charged), no
  S3 (uploads are disabled). The payment shown in the app is a synthetic
  database record.
- **Data:** synthetic accounts A and B with fictional clients and invoices;
  random passwords in `~/.invoiceme-phone-test/accounts.txt` (mode 600).
  JWT secrets are random and used only here.

## How a phone connects

A phone cannot reach `localhost` on this computer. The supported method is
**USB with `adb reverse`**: `connect-phone.sh` maps the phone's own
`127.0.0.1:3900` to this computer's `127.0.0.1:3900` through the cable. The
phone test APK is built with `API_BASE_URL=http://127.0.0.1:3900/api/v1`
for exactly this. You must, on the phone: enable Developer options and USB
debugging, connect the cable and allow this computer. The mapping lasts
until the cable is unplugged or `connect-phone.sh --disconnect`; run it
again after reconnecting. To simulate being offline, disconnect the
mapping.

Only phones attached by USB cable are used: network and wireless-debugging
adb devices (for example a TV) are never selected; with several USB phones
set `ANDROID_SERIAL`. In your own `adb` commands use `adb -d` (USB device
only).
