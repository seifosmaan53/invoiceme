# Release handoff (2026-10-29)

Where InvoiceMe stands after the 2026 security and sync work, what can be
tested now, and what must happen before a real release. Three things are kept
apart throughout:

| | What it is | Status |
|---|---|---|
| **Tested source** | Code on `main`, with CI results | `ed065aa` (PR #27, per-account local storage) on `849552b` (app and server) and the release tooling of PR #26 |
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

### Update: `ed065aa` (2026-10-30), account isolation

PR #27 fixed the account-switching defect (DEVICE-ACCEPTANCE.md item 10).
The server code is unchanged since `849552b`.

| Run | Workflow | Result | Contents |
|---|---|---|---|
| [41108401365](https://github.com/seifosmaan53/invoiceme/actions/runs/41108401365) | CI | success | backend unit, database E2E, restore-socket, container PDF; mobile `flutter test` (151 tests, including the account switch regression and isolation tests) |
| [41108401392](https://github.com/seifosmaan53/invoiceme/actions/runs/41108401392) | Update bundle | success | Ubuntu and Windows install |
| [41108435367](https://github.com/seifosmaan53/invoiceme/actions/runs/41108435367) | Android test candidate (manual, on main) | success | **Android 11 emulator against a real backend: 4 of 4 passed** (the earlier three plus account switching between two synthetic accounts); test APK below |

## 2. Test artifact

**For a physical phone: build of `6c3c230`** (app code identical to
`ed065aa`; only documentation changed in between). The `ed065aa` build
below is compiled for the emulator's host address (`10.0.2.2`), which a
phone cannot reach; this one targets `http://127.0.0.1:3900/api/v1`, the
phone-test backend over USB (`scripts/phone-test/`).

| Item | Value |
|---|---|
| File | `invoiceme-synctest-1.0.0-100021-6c3c230.apk`, artifact of run [41118674827](https://github.com/seifosmaan53/invoiceme/actions/runs/41118674827) (emulator 4 of 4 in the same run) |
| SHA-256 | `cd896fa0018cb46056c3c74ba2b0f868a5acea65f558df9830124ed4d396c1d3` |
| Application id | `com.example.invoiceme.synctest`, versionName 1.0.0, versionCode 100021 |
| Signing | throwaway Android debug key, certificate SHA-256 `c9fd0dfebf327cc1712af323276b0d6ca7e2d2dc9f48bbad3cdad71360e282fc`. **Not a release key** |
| Compatibility | cannot be installed over (or beside) any earlier test build; see DEVICE-ACCEPTANCE.md |

The owner's handoff folder (outside the repository) holds both APKs with
their `SHA256SUMS`, `release-record.txt`, an install guide and the
checklist.

**Emulator build: `ed065aa`**

| Item | Value |
|---|---|
| File | `invoiceme-synctest-1.0.0-100019-ed065aa.apk` (67,492,488 bytes), artifact `invoiceme-synctest-apk` of run 41108435367 (14-day retention); owner's local copy in the release workspace `mobile-rc/ed065aa/` with `SHA256SUMS` and `release-record.txt` |
| SHA-256 | `844e107e19a44330ad0476e9c36562ceb503149cc1cca53cd093fcce575d720e` |
| Application id | `com.example.invoiceme.synctest`, label "InvoiceMe (sync test)", versionName 1.0.0, versionCode 100019 |
| Signing | that CI runner's throwaway **Android debug key** (`CN=Android Debug`, certificate SHA-256 `f8ea52e20d560698e7a15fd88fc7de3d9c7c4b3a0eb2fabd2583f25c530ac7bb`). **Not a release key** |
| Compatibility | same application id as the `849552b` and `72ae129` test APKs but a **different key**: Android will not install it over them (and not beside them). Use a phone without an InvoiceMe test build, or keep the earlier build until its changes are synced; nothing requires removing it. A stable test key (ANDROID-RELEASE.md section 5) would allow updates between later test builds |

**Superseded: `849552b`** (has the account-switching defect; do not switch accounts on a phone running it):

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
   not verified on a physical phone (repeat testing declined by the owner,
   2026-10-30). Do not switch accounts on a phone
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
7. Physical-phone testing is **owner-reported** (an earlier build; build and
   coverage not recorded); the owner declined repeat testing of the current
   build (2026-10-30), so no individual phone check is verified for it
   (DEVICE-ACCEPTANCE.md). No iOS build exists.

## 4. Owner-managed requirements before a real release

Android (details and secure setup: [ANDROID-RELEASE.md](ANDROID-RELEASE.md)):
1. **Decided (2026-10-30):** application id `com.seifosman.invoiceme`.
2. **Decided (2026-10-30):** direct APK pilot, version 1.1.0 = versionCode
   10100 (values in ANDROID-RELEASE.md section 0).
3. Create the **production key** on your own machine; back it up twice.
4. Create a **private repository** and its `android-release` environment
   (required reviewer = you); store key, passwords and the production URL as
   environment secrets with `gh secret set` (prompts, nothing in chat).
5. Optional: a **dedicated test key** in this repository's secrets, so test
   builds keep one identity.
6. Physical-phone acceptance: **owner-reported, repeat declined**
   (DEVICE-ACCEPTANCE.md status). The pilot (SERVER-RELEASE-CHECKLIST.md
   step 11) is the first use of the production build on phones.
7. Build with the release workflow, verify the artifact and record
   (ANDROID-RELEASE.md 3.4), and distribute yourself, pilot phones first.

Server ([SERVER-RELEASE-CHECKLIST.md](../operations/SERVER-RELEASE-CHECKLIST.md)):
8. Identify the installation, verify a backup restores, review and rehearse
   migrations 018-022, configure (timezone, HTTPS/proxy, API keys, legacy
   cutoff unset, historical overdue emails off), Stripe webhook, verify.
9. Give phones an `https://` address with a certificate they trust.

iOS ([IOS-ASSESSMENT.md](IOS-ASSESSMENT.md)): separate track; needs bundle
id, Apple Developer membership, signing, privacy strings, a Mac toolchain.
It does not block an Android-only test release.

## 5. What can be tested now, and what must happen before a real release

**Phone testing:** owner-reported; the owner declined repeat testing of the
current build (2026-10-30). The tooling below stays available if that
changes: start the isolated phone-test backend (`scripts/phone-test/start.sh`),
connect a spare phone by USB (`scripts/phone-test/connect-phone.sh`),
install the phone build of the `.synctest` test APK, sign in with the
synthetic accounts A and B, and work through
[DEVICE-ACCEPTANCE.md](DEVICE-ACCEPTANCE.md). Payments only as the
seeded synthetic record (the phone-test backend has no payment provider), or
in Stripe test mode on another test backend. The server release can be rehearsed on a
restored copy of a database, never on the live installation.

**Before a real release:** the remaining owner setup in section 4 (key,
private repository, `https://` address), the server update done per the checklist at the installation by
the owner, and then a production build from the release workflow in the
private repository, distributed by the owner. Until then nothing has been
released.
