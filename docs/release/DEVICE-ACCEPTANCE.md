# Physical-device acceptance checklist (Android)

Short checklist for a real phone before any production release. Use a **test
backend** (never the customer's server), **synthetic accounts** only, and
payments only in the provider's **test mode** or mocked. Nothing here has been
run on a physical phone yet: every "Phone" cell below is **not run**.

Build under test: the `.synctest` test APK (record its file name and SHA-256
from the run's `SHA256SUMS`), built with `api_base_url` pointing at the test
backend: Actions > Android test candidate > Run workflow. The test APK
allows plain HTTP, so a LAN test backend works; a production build will not
(it needs `https://`).

Evidence legend:
- **Emulator**: passed in CI on an Android 11 emulator against a real backend
  (`android-test.yml` job `emulator-e2e`, last on main `849552b`, run
  40971835817).
- **Host**: passed in the app's host tests on a real SQLite database with a
  simulated server (`mobile/test/`), not on a device.
- **Server**: passed in the backend's database E2E tests (`backend/test/`).
- **None**: no automated evidence.

| # | Check (how) | Expected | Automated evidence | Phone |
|---|---|---|---|---|
| 1 | **Fresh install.** Install the APK on a phone without InvoiceMe test builds; open; sign in with synthetic account A | App opens, signs in, lists A's data; label "InvoiceMe (sync test)"; it sits beside any other InvoiceMe app | Emulator (install + sign-in) | not run |
| 2 | **Upgrade from an earlier compatible test build.** Install build N, create data, go offline, make an edit (pending), then install build N+1 over it | Install succeeds, the pending edit is still queued and syncs once online | Host (database upgrade from version 2 keeps the queue; versions 5-7 idempotent). Not possible yet on a phone: the existing test APKs have different keys; needs two builds signed with the stable test key (ANDROID-RELEASE.md section 5) | not run |
| 3 | **Local database migration** on a device that has data from an older app version | No pending change lost; app opens at the current database version | Emulator (native SQLite v2 to current, reopen changes nothing); Host (pending rows kept) | not run |
| 4 | **Offline edits and reconnection.** Airplane mode; create a client, edit an invoice; reconnect; sync | Changes reach the server once; nothing duplicated | Host (queue, cursor paging); Server (idempotent change ids, delivery) | not run |
| 5 | **Conflict and resolution.** Edit the same invoice field on the web and offline on the phone; sync | A conflict appears in Settings > Data & Sync with both versions; "Use my version" / "Keep current version" behave as labelled; afterwards the phone shows the server's current record | Emulator (stale edit, conflict screen, use my version); Host (held rows, re-delivery after resolution); Server | not run |
| 6 | **Retry after restart.** Stop the backend (or block it), queue a change, sync (temporary failure), force-close the app, reopen | "Waiting to retry" lists the change with attempts and next attempt; it is never given up; "Retry now" sends it once the backend is back | Host (backoff persisted across a new service instance, retry now) | not run |
| 7 | **Deletion delivery.** Delete a client/invoice on the web; sync the phone. Then restore it on the web and sync again | Gone from the phone after the first sync; back, with its lines and attachments, after the second | Server (tombstones, restore re-delivers children); Host (tombstones applied) | not run |
| 8 | **Payment state.** On the test backend, an invoice paid with a provider **test-mode** payment, then partially refunded (test mode / mocked) | Invoice detail shows the payment card: paid, refunded, net; Reopen only after confirmation | Emulator (payment card from a real invoice response with a synthetic partial refund; Reopen) | not run |
| 9 | **Attachment links.** Open an attachment with a normal storage URL; on the test backend, one seeded with an unsafe URL (e.g. `javascript:`) | The normal one opens; the unsafe one is not offered/opened | Host (URL check unit tests); Server (unsafe URLs left out of listings and sync) | not run |
| 10 | **Logout and account switching.** Account A queues an offline change; log out; sign in as synthetic account B on the same phone; sync; log out; sign in as A; sync. Also: start a sync and log out while it runs; and force-close the app during sign-in | B never sees, sends or receives A's data (Settings > Data & Sync shows nothing of A; no "could not be synced" or conflict entries of A); A's pending change stays queued and is sent when A signs in again; logout offers to keep or (after a warning about unsynced changes) remove the phone's data | Emulator (A queues offline, B signs in and syncs a clean store, A resumes and sends the change; native SQLite, real backend); Host (switch during an in-flight pull or push, restart during a transition, conflicts/retries/held rows/attachments, earlier-version database moved or quarantined, removal with confirmation, token/account binding) | not run. **Required on a physical phone before any production release** |
| 11 | **PDF.** Open an invoice PDF (view/share/print) | PDF renders; correct invoice | Server (PDF rendering in the container smoke test); None on device | not run |

Record for each run: phone model, Android version, build file and SHA-256,
test backend commit, account names used (synthetic), result, and screenshots
of failures. Do not call a check passed unless it ran on the phone.

## Account switching on one phone (item 10): fixed in the app source

Found 2026-10-29: the app kept one local database and one sync cursor for
every account, and sign-out removed only the credentials. After A signed
out and B signed in, B's sync sent A's queued changes with B's session,
continued from A's cursor (so B's records were not downloaded) and B's
screens could list A's failed changes. Kept as a regression test
(`mobile/test/services/account_switch_regression_test.dart`; it fails on
the earlier code).

Fixed by per-account local storage (docs/SYNC-CONTRACT.md "Local data per
account"): every account has its own database, only the signed-in one is
open, sign-out stops and invalidates running sync work first, and the
shared database of earlier versions is assigned to its one owner or
quarantined. Automated evidence is in item 10. **It has not been tested on a
physical phone**: item 10 must pass on a real phone before a production
release, including with an earlier test build installed that has data.
