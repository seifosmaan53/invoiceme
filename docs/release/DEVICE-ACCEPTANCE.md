# Physical-phone acceptance checklist (Android)

Run on a **spare** Android phone, against the isolated **phone-test backend**
on your computer (`scripts/phone-test/`, see its README), with its synthetic
accounts A and B. Never a customer server, never real customer data;
payments only as the seeded synthetic record (no payment provider is
configured, so nothing can be charged and no email is sent).

**Status: nothing below has been run on a physical phone.** Every "Phone"
cell is **NOT RUN** until you run it and record the result. The automated
evidence is listed separately and is not phone evidence:
- **Emulator**: passed in CI on an Android 11 emulator against a real
  backend (`android-test.yml` job `emulator-e2e`; on `ed065aa`, run
  41108435367, 4 of 4).
- **Host**: passed in the app's host tests on real SQLite with a simulated
  server (`mobile/test/`), not on a device.
- **Server**: passed in the backend's database E2E tests.

## What the app can and cannot do on a phone (this version)

The screens save directly to the server; **no screen queues offline
changes**, and sync runs only from Settings > Data & Sync > Sync. On a phone
you therefore cannot create an offline change, a device-side conflict or a
retry by tapping. Those checks run on the phone with the **on-device tests**
(`scripts/phone-test/run-device-tests.sh`): the same flows as the emulator
job, queueing changes through the app's real sync service and resolving a
conflict in the real conflict screen, on the phone's own SQLite.

## Before you start

1. On your computer: `scripts/phone-test/start.sh` (prints where the
   synthetic passwords are: `~/.invoiceme-phone-test/accounts.txt`).
2. On the phone: Settings > About phone > tap "Build number" 7 times;
   Settings > System > Developer options > **USB debugging** on.
3. Connect the phone by USB, accept "Allow USB debugging" for this computer,
   then on the computer: `scripts/phone-test/connect-phone.sh`. It must print
   `backend reachable`. (Needs Android platform-tools `adb`.)
4. Check for an earlier test build: `adb shell pm list packages | grep invoiceme`.
   If `com.example.invoiceme.synctest` is listed, **stop**: see
   "An earlier test build is on the phone" below.

## Checklist

| # | Do | Expected | Automated evidence (not phone) | Phone |
|---|---|---|---|---|
| 1 | **Install.** `adb install <phone APK>` (from the handoff folder; never over another build). Open "InvoiceMe (sync test)" | Installs as a new app; opens the sign-in screen | Emulator (install, sign-in) | NOT RUN |
| 2 | **A signs in and syncs.** Sign in as A (`A_EMAIL`/`A_PASSWORD`). Settings > Data & Sync > Sync | Clients "Northwind Test Co (A)", "Delete-me Test Client (A)"; three invoices (draft $120, sent $250, paid $100); sync completes; "Last synced" shows | Emulator, Host | NOT RUN |
| 3 | **Switch to B.** Logout (keep data). Sign in as B. Look at clients, invoices, Settings > Data & Sync (incl. "could not be synced" and conflicts); Sync | Only "Contoso Test Ltd (B)" and its sent $75 invoice; Data & Sync shows nothing of A (no pending, failed or conflict entries; its own last-sync time); sync completes | Emulator (B starts with an empty store, never sends A's changes), Host | NOT RUN |
| 4 | **Back to A.** Logout, sign in as A, Data & Sync, Sync | A's data and sync status as in step 2; nothing of B | Emulator (A's queued change is still there and is sent by A), Host | NOT RUN |
| 5 | **Switch during an active sync.** As A: tap Sync and immediately Logout; sign in as B; Sync | No crash; B sees only B; A's next sign-in and Sync work | Host (switch during an in-flight download or upload: nothing written to either account) | NOT RUN |
| 6 | **Deletion delivery.** On the computer: `scripts/phone-test/as-account.sh A DELETE /clients/<A_DELETE_ME_CLIENT_ID>`; on the phone as A: Sync, open Clients | "Delete-me Test Client (A)" is gone | Server (tombstones), Host (tombstones applied) | NOT RUN |
| 7 | **Payment state.** As A open the paid $100 invoice | Payment card: Partially refunded; Paid (gross) $100.00, Refunded $30.00, Net received $70.00; Reopen only after a confirmation (cancel it if you will run step 10 afterwards) | Emulator (same seeded state) | NOT RUN |
| 8 | **Attachment link.** As A open the paid $100 invoice > attachments | Only "normal-link.pdf" is listed and opens the browser at example.com; the seeded unsafe `javascript:` link is never shown | Server (unsafe URLs left out), Host (URL check) | NOT RUN |
| 9 | **PDF.** As A open the draft $120 invoice > PDF (view, share) | The PDF renders, for that invoice | Server (PDF rendering); the test backend renders with this computer's Chrome | NOT RUN |
| 10 | **On-device sync tests.** `scripts/phone-test/run-device-tests.sh` (needs Flutter on the computer; installs a separate debug test app, package `com.example.invoiceme`) | `All tests passed!` for: native SQLite migration; a queued offline change and a server edit of the same field produce a conflict, resolved with "Use my version" in the conflict screen; account switching (A's queued change stays with A, B starts clean and never sends it, A sends it after signing in again); payment card | Emulator (identical tests) | NOT RUN |
| 11 | **Restart keeps state.** As A: force-close the app (Settings > Apps > Force stop), reopen | Still signed in as A (or the sign-in screen if the session expired); same data and Data & Sync status | Host (restart while signed in) | NOT RUN |
| 12 | **Remove local data.** As A: Logout > "Logout and remove data from this phone" | A second confirmation; with unsynced changes a warning and a tick box. Afterwards A signs in to an empty phone store and Sync downloads A's data again | Host (removal needs confirmation with unsynced changes) | NOT RUN |

Not checkable on a phone with this version (no screen queues changes):
**retry after a restart** (a change "waiting to retry" survives restarts and
is never given up) has Host evidence only.

Record for each run: phone model and Android version, the APK file and
SHA-256, the backend commit (`git rev-parse HEAD`), which synthetic account,
the result, and screenshots of failures.

## Diagnostics without secrets

`scripts/phone-test/collect-logs.sh` writes the test app's own log lines
(logcat filtered to its process) and the test backend's log, with tokens,
JWTs, passwords and e-mail addresses masked. Review the files before sharing.
Do not share `accounts.txt`, screenshots of the sign-in fields, or a full
`adb bugreport` (it contains much more than this app).

## An earlier test build is on the phone

The test APKs are signed with throwaway debug keys that differ for every CI
run (`72ae129`: `8170b77e…32ce`; `849552b`: `dd265408…933b`; `ed065aa`:
`f8ea52e2…c7bb`; the phone build of `6c3c230`: `c9fd0dfe…82fc`). They share
one application id, so Android refuses to install one over another
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), and they cannot be installed side by
side. No new key can ever update them.

If the phone has an earlier test build:
- **Keep it**, and use another spare phone for this checklist. Nothing here
  requires removing it.
- Its data lives only in that app. If it may hold unsynced changes, open it
  while connected to the backend it was built for and sync until Data & Sync
  shows nothing pending, failed or in conflict. Builds before `ed065aa` have
  the account-switching defect: sync them only with the account that made
  the changes.
- Remove it only after that, only if you decide to, and only on a phone
  holding test data.

Future test builds can update each other once a stable test key is set up
(ANDROID-RELEASE.md section 5); that key cannot update any of the builds
above.
