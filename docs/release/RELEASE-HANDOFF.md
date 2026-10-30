# Release handoff (2026-10-29)

Where InvoiceMe stands after the 2026 security and sync work, what can be
tested now, and what must happen before a real release. Three things are kept
apart throughout:

| | What it is | Status |
|---|---|---|
| **Tested source** | Code on `main`, with CI results | `849552b` (app and server); release tooling added afterwards in PR #26 |
| **Test APK** | A debug-signed `.synctest` build for testing only | exists (below); not for customers |
| **Production release** | A production-signed app distributed to users, and a server updated at an installation | **none.** No production app has been built or published; no server installation has been updated or verified, including the customer's warehouse installation, which the owner maintains privately |

## 1. Baseline: tested source `849552b`

`main` at `849552b` = PR #25 (sync integrity closeout) on PR #24 (release
blockers) and earlier merged work. Workflow runs on that commit:

| Run | Workflow | Result | Contents |
|---|---|---|---|
| [40971817011](https://github.com/seifosmaan53/invoiceme/actions/runs/40971817011) | CI | success | backend: lint, unit tests **658 passed**, database E2E **385 passed + 1 skipped of 386** (an environment-dependent case; the Unix-socket restore case runs in the separate `restore-socket` job, **13 passed**), container build and PDF smoke test; mobile: `flutter test` (services, utils, full suite) |
| [40971816945](https://github.com/seifosmaan53/invoiceme/actions/runs/40971816945) | Update bundle | success | Node 20 bundle built; installed and started on **Ubuntu and Windows**; migrations applied; strict health check, HTTPS enforcement (including a spoofed header), integrity report, dump/restore verification, PDFs rendered with the system browser |
| [40971835817](https://github.com/seifosmaan53/invoiceme/actions/runs/40971835817) | Android test candidate (manual, on main) | success | test APK built and verified; **on an Android 11 emulator against a real backend: 3 of 3 passed** (native SQLite migration v2 to current, protocol-2 conflict on push resolved in the conflict screen, payment card with a partial refund and Reopen) |

Local runs on the same code (macOS): backend unit 658, E2E 386 of 386,
mobile 124 tests, `dart analyze` 0 errors. E2E reliability: with the test
harness fix in PR #25, 20 of 20 paired full E2E runs passed (3 of 20 failed
before the fix); evidence kept outside the repository.

## 2. Test artifact

| Item | Value |
|---|---|
| File | `invoiceme-synctest-849552b.apk` (67,344,936 bytes), artifact `invoiceme-synctest-apk` of run 40971835817 (14-day retention); the owner's local copy is in the release workspace `mobile-rc/849552b/` |
| SHA-256 | `9fa0882fb0fb3bf6300c1748d8fce4a9352cdee808a418effda2dae23041364d` |
| Application id | `com.example.invoiceme.synctest`, label "InvoiceMe (sync test)", versionName 1.0.0, versionCode 1 |
| Signing | the CI runner's throwaway **Android debug key** (`CN=Android Debug`, certificate SHA-256 `dd2654080ed10386436d66b9c3ac71047dc4280fb7438b4fbf2483f4ad43933b`). **Not a release key** |
| Network | allows plain HTTP (test builds only); default server is the emulator's host |
| Installs | beside any other InvoiceMe app; **cannot** update the earlier test APK from `72ae129` (different throwaway key). Keep earlier test builds until their changes are synced; nothing requires removing them |
| Use | testing with synthetic accounts and a test backend only; never customer phones, never published |

All builds are listed in [android-versions.tsv](android-versions.tsv).

## 3. Known limitations (as of `849552b`)

1. **Account switching on one phone leaked queued changes across accounts**
   in `849552b` and the test APK built from it (found 2026-10-29). Fixed in
   the app source after this baseline (per-account local storage; host and
   emulator tests), see [DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md) item 10;
   not yet tested on a physical phone. Do not switch accounts on a phone
   running the `849552b` test APK.
2. Overdue emails are sent at most once and **not retried** if the server
   stops between marking and sending, or a send fails.
3. Older apps (protocol 1) keep last-write-wins on drafts, clients and
   attachments and can miss a write until a full resync; ends when every
   phone runs a protocol-2 app and the legacy cutoff is set later.
4. Refunds/disputes from before migration 020 are not reconstructed.
5. Each mobile pull rechecks at most 50 conflicts (round-robin); with q
   conflicts a resolution elsewhere is noticed within ceil(q/50) pulls.
6. A device that resolves a conflict with "use my version" may briefly show
   an older server row if the server did not report the new revision; the
   next pull corrects it.
7. No physical-device testing has been done; no iOS build exists.

## 4. Owner-managed requirements before a real release

Android (details and secure setup: [ANDROID-RELEASE.md](ANDROID-RELEASE.md)):
1. Decide the **application id** (proposal `com.seifosman.invoiceme`) after
   checking whether staff phones already run an InvoiceMe app.
2. Decide the **distribution method** (APK sideload/device management, or
   Google Play with AAB) and the **version plan** (proposal: 1.1.0 =
   versionCode 10100).
3. Create the **production key** on your own machine; back it up twice.
4. Create a **private repository** and its `android-release` environment
   (required reviewer = you); store key, passwords and the production URL as
   environment secrets with `gh secret set` (prompts, nothing in chat).
5. Optional: a **dedicated test key** in this repository's secrets, so test
   builds keep one identity.
6. Test **account switching** on a physical phone (DEVICE-ACCEPTANCE.md
   item 10) with a test build that contains the fix.
7. Run [DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md) on a physical phone
   against a test backend; then build with the release workflow, verify the
   record, and distribute yourself.

Server ([SERVER-RELEASE-CHECKLIST.md](../operations/SERVER-RELEASE-CHECKLIST.md)):
8. Identify the installation, verify a backup restores, review and rehearse
   migrations 018-022, configure (timezone, HTTPS/proxy, API keys, legacy
   cutoff unset, historical overdue emails off), Stripe webhook, verify.
9. Give phones an `https://` address with a certificate they trust.

iOS ([IOS-ASSESSMENT.md](IOS-ASSESSMENT.md)): separate track; needs bundle
id, Apple Developer membership, signing, privacy strings, a Mac toolchain.
It does not block an Android-only test release.

## 5. What can be tested now, and what must happen before a real release

**Now:** install the `.synctest` test APK on a test phone (it sits beside any
other InvoiceMe app), point it at a **test** backend (build one with
Actions > Android test candidate > Run workflow, `api_base_url` = the test
backend), sign in with synthetic accounts, and work
through [DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md). Payments only in
Stripe test mode or mocked. The server release can be rehearsed on a
restored copy of a database, never on the live installation.

**Before a real release:** the owner decisions and setup in section 4, the
account-switching check on a physical phone (item 10) and the rest of the
physical-device acceptance, the server update done per the checklist at the installation by
the owner, and then a production build from the release workflow in the
private repository, distributed by the owner. Until then nothing has been
released.
