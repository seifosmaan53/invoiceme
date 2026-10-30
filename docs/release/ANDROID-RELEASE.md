# Android release: identity, signing and builds

How a production Android build of InvoiceMe is made, and what the owner must
decide or set up first. Nothing here publishes an app: the workflows build,
verify and record; distribution is a separate owner step.

Status: **no production Android build exists.** Only test APKs (separate
`.synctest` identity, debug-signed) have been produced; see
[RELEASE-HANDOFF.md](RELEASE-HANDOFF.md).

## 0. Production configuration proposal (for the owner's review)

Checked 2026-10-30 against the repository, the build ledger
([android-versions.tsv](android-versions.tsv)) and the project records: **no
production identity, signing key or production release exists.** The ledger
holds only test builds (`.synctest`, versionCodes 1 and 1000xx); a test
build's versionCode is not production history. What phones in the field run
is unknown to these records (section 1, owner check).

| Item | Proposal | Status |
|---|---|---|
| Application id | `com.seifosman.invoiceme` | **Owner decision.** Confirm you control `seifosman.com` (or choose the customer's reversed domain with their agreement), and that no InvoiceMe app is already installed on staff phones (section 1) or published under that id |
| Distribution | Direct APK to a few phones for an initial controlled pilot (section 2.3) | **Owner decision** |
| Format | `apk` | follows from the distribution |
| Version | `1.1.0`, versionCode `10100` (scheme `MAJOR*10000+MINOR*100+PATCH`, section 2.2); above every production line in the ledger (there are none) | **Owner decision** (accept or change) |
| Signing key | A new production key created by you on your own machine (section 3.2); never the test key | **Not created.** Needs your explicit go-ahead; never sent to chat |
| Server address | `https://<host>/api/v1` with a certificate the phones trust (section 4) | **Owner decision**, from the installation |
| Build repository | A private repository of yours with the `android-release` environment (sections 3.1, 3.3) | **Owner action** |
| Source | A full commit SHA in `main` that was reviewed and tested | chosen at build time |

**Configuration changes:** none in the code. The id, version, key and URL
are inputs, variables and secrets of the release workflow (sections 3.3,
3.4); the repository keeps the placeholder `com.example.invoiceme`, which the
release workflow refuses.

## 1. Current identity (verified 2026-10-29)

| Item | Value | Source |
|---|---|---|
| Application id | `com.example.invoiceme`: Flutter's **placeholder**, never chosen | `mobile/android/app/build.gradle.kts` (unchanged since the initial commit) |
| Code namespace | `com.example.invoiceme` | same; independent of the application id, needs no change |
| Version | `1.0.0+1` since the initial commit; never incremented | `mobile/pubspec.yaml` history |
| Release signing | the debug key unless signing is configured (below) | `build.gradle.kts` |
| Store listing, upload key, signing records | none in the repository or the project records | |
| Test builds | `com.example.invoiceme.synctest`, label "InvoiceMe (sync test)", cleartext HTTP allowed, debug key of the CI runner | `-PinvoicemeTestBuild=true` |

**Unknown, and decisive:** whether staff phones already run an InvoiceMe app
built from this code, and if so its application id and signing certificate.
Android only installs an update when **both** match. This must be checked by
the owner on a phone (not by tooling here):

1. On the phone: Settings > Apps > InvoiceMe > App details (or "App info");
   note the package name if shown. With a computer and USB debugging:
   `adb shell pm list packages | grep -i invoice` and
   `adb shell dumpsys package <package> | grep -E "versionName|versionCode"`.
2. If a build with the same package exists and you still have the file that
   was installed: `apksigner verify --print-certs <file>.apk` shows its
   certificate. A certificate `CN=Android Debug` means it was signed with a
   development machine's debug key; no production key can update it.

## 2. Decisions for the owner

### 2.1 Application id (permanent)

The id is the app's identity on every phone and store; it cannot change
later without becoming a different app.

- **If no InvoiceMe app is installed on staff phones (expected): choose a new
  id under a domain you control.** Proposal: `com.seifosman.invoiceme`
  (you hold `seifosman.com`). If the app is distributed under the
  customer's name, use their reversed domain instead, with their agreement.
- **If an app is installed:** keep its id only if you also hold the key that
  signed it and that key is suitable for production (not a debug key). If it
  was debug-signed, a new id and key are unavoidable: the new app installs
  **beside** the old one. Let the old app sync its pending changes and keep
  it installed until they are on the server; never remove an app that may
  hold unsynced changes.
- The placeholder is refused by the release workflow unless the owner sets
  `ANDROID_ACCEPT_EXAMPLE_ID=true`, which is meant only for the second case.

### 2.2 Versioning

- `versionName`: `MAJOR.MINOR.PATCH`, shown to users.
- `versionCode`: an integer that must increase with every build installed
  as an update. Proposal: `MAJOR*10000 + MINOR*100 + PATCH`, so the first
  production release `1.1.0` is `10100` and a hotfix `1.1.1` is `10101`.
- Every build that leaves CI is recorded in
  [android-versions.tsv](android-versions.tsv). The release workflow refuses
  a production `versionCode` that is not above every recorded production
  code for the same id; add the line (from the build's
  `release-record.txt`) in a reviewed commit after each production build.
- Test builds use `versionCode = 100000 + workflow run number` on their own
  `.synctest` id, so they never collide with production codes.

### 2.3 Distribution method, and so the format

| Method | Format | Signing notes |
|---|---|---|
| A few company phones: install the file, or device management (MDM) | **APK** (`format: apk`) | Your release key signs what users install. Losing the key means no further updates to installed copies: keep two secure backups |
| Google Play (also its internal testing track) | **AAB** (`format: aab`) | With Play App Signing, the key used here is the **upload key**; Google re-signs with the app signing key. Set `ANDROID_RELEASE_CERT_SHA256` to the upload key's fingerprint. A lost upload key can be reset through Play |

## 3. One-time owner setup (secure)

Keys, passwords and the production URL never go into chat, email, tickets,
issues, commit messages or this repository.

### 3.1 A private repository for releases

This repository is public: a run's inputs, logs and artifacts are visible to
any signed-in GitHub user, so `android-release.yml` refuses to run here (its
first step stops unless `github.event.repository.private` is true). That is
deliberate: a signed production APK, its run logs and the production URL
should not be public, and environment secrets with approval rules belong in
a repository only you can see.

Supported arrangement (owner-run, nothing automatic):
- **This public repository stays the place of review and CI.** Its
  visibility does not change.
- **A private repository of yours is only for release builds.** Create it
  empty on GitHub (e.g. `invoiceme-release`), then push the reviewed `main`
  from your own clone. The history is the same public history (it contains
  no secrets); secrets are created only in the private repository (section
  3.3) and are never copied from anywhere.

```sh
git remote add release git@github.com:<you>/invoiceme-release.git
git fetch origin && git push release origin/main:refs/heads/main   # after each reviewed merge you want to release
```

- Never set up an automatic mirror, and never push the private
  repository's workflow artifacts, secrets or logs anywhere else.

### 3.2 Create the production key on your own machine

Only with your explicit decision to create the production key (it is
permanent: every update of the app must be signed with it). `keytool` comes
with a Java JDK; if `keytool -help` fails, install one first (e.g.
`brew install --cask temurin@17`). Work in a folder outside any repository;
`keytool` prompts for passwords without echoing them:

```sh
keytool -genkeypair -v -keystore invoiceme-release.jks -alias invoiceme \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=<your name or company>, O=<organisation>, C=<country>"
keytool -list -v -keystore invoiceme-release.jks -alias invoiceme | grep SHA256
```

Store the `.jks` file and both passwords in your password manager **and** an
encrypted offline backup (two separate places); check that the backup opens
(`keytool -list -keystore <backup copy>`). The `SHA256` line is the
certificate fingerprint; it is not secret: it becomes
`ANDROID_RELEASE_CERT_SHA256`. Do not keep the `.jks` in a synced or shared
folder, and never in a repository.

### 3.3 The `android-release` environment (private repository)

Settings > Environments > New environment `android-release`:
- **Deployment branches:** `main` only.
- **Required reviewers:** yourself, so each release run waits for your
  approval, where your plan offers it.

GitHub plan limits (check your account's current plan): for a **private**
repository, environments and environment secrets need GitHub Pro, Team or
Enterprise, and required reviewers need Enterprise. Without them, set the
same names below as **repository** secrets and variables of the private
repository (drop `--env android-release`): the workflow reads them the same
way, and only you can start it there. The approval gate is then your own
decision to run the workflow.

Secrets and variables with the GitHub CLI. `gh secret set` without
`--body` prompts and does not echo; the keystore is read from a pipe:

```sh
R=<you>/invoiceme-release
base64 -i invoiceme-release.jks | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64 --env android-release --repo $R
gh secret set ANDROID_RELEASE_KEYSTORE_PASSWORD --env android-release --repo $R
gh secret set ANDROID_RELEASE_KEY_ALIAS        --env android-release --repo $R   # invoiceme
gh secret set ANDROID_RELEASE_KEY_PASSWORD     --env android-release --repo $R
gh secret set ANDROID_RELEASE_API_BASE_URL     --env android-release --repo $R   # https://<server>/api/v1
gh variable set ANDROID_APPLICATION_ID     --env android-release --repo $R --body <chosen id>
gh variable set ANDROID_RELEASE_CERT_SHA256 --env android-release --repo $R --body <SHA256 from 3.2>
```

Also set `ANDROID_TEST_CERT_SHA256` here (the test key's fingerprint, section
5) so a release run refuses the test key; certificate fingerprints are not
secret.

### 3.4 A production build

Actions > **Android release build** > Run workflow:

| Input | Meaning |
|---|---|
| `ref` | Full commit SHA (or tag) of a reviewed commit; must be contained in `main` and include this release tooling (PR #26 or later; older commits such as `849552b` are refused) |
| `version_name`, `version_code` | Section 2.2 |
| `format` | `apk` or `aab` (section 2.3) |
| `retention_days` | How long the signed artifact stays downloadable from the run (1-14; default 3) |

What it does, in order (`.github/workflows/android-release.yml`):
1. refuses a public repository; checks the commit is in `main` and has this
   tooling; checks the inputs; `flutter analyze` (errors fail) and
   `flutter test`;
2. waits for the environment's approval (where configured); checks the
   version against the ledger **on main**; fails naming any missing secret
   or variable (never values); refuses the placeholder id and any URL that
   is not `https://<host>/api/v1`;
3. writes the keystore to a private temporary file, checks its certificate
   against `ANDROID_RELEASE_CERT_SHA256` (and that it is not the test key)
   **before building**;
4. builds with the key from the environment only
   (`invoicemeRequireSigning=true`: no fallback to the debug key);
5. verifies the artifact: application id, version, signing certificate (not
   a debug certificate, the expected fingerprint), no cleartext-HTTP
   permission. For an APK all of it is read from the APK. For an AAB the
   signature and certificate come from the bundle, the application id must
   appear in the bundle's own manifest, and version and cleartext come from
   the merged manifest Gradle built it from. Writes `SHA256SUMS` and
   `release-record.txt` (source commit,
   version, id, certificate DN and SHA-256, artifact SHA-256, URL scheme
   only, run link);
6. deletes the keystore (also on failure) and uploads the artifact to the
   run. It publishes nothing and installs nothing.

Before distributing, verify what you downloaded:

```sh
shasum -a 256 -c SHA256SUMS                          # the file is the one the run built
grep -E 'application_id|version_|debug_certificate|cleartext|source_commit|signing_certificate_sha256' release-record.txt
keytool -printcert -jarfile invoiceme-*.apk | grep SHA256   # equals your key's fingerprint (section 3.2)
# if keytool prints nothing (no v1 signature): apksigner verify --print-certs invoiceme-*.apk   (Android build-tools)
```

Expected: your application id and version; `debug_certificate=false`;
`cleartext_http_allowed=false`; `source_commit` = the SHA you entered;
the certificate fingerprint = `ANDROID_RELEASE_CERT_SHA256`. Install it on a
test phone first (DEVICE-ACCEPTANCE.md) before any staff phone. Keep
`release-record.txt`, add the ledger line in a reviewed commit, and delete
the run's artifact once you have it.

## 4. Server address and network security

- The server URL is compiled into the app (`--dart-define=API_BASE_URL=…`);
  without it the app uses development addresses (`http://10.0.2.2:3000/…`
  on Android). A production build always gets `ANDROID_RELEASE_API_BASE_URL`,
  which must be `https://<host>/api/v1`.
- Production builds carry **no** cleartext-HTTP allowance: that setting is
  only in `mobile/android/app/src/synctest/AndroidManifest.xml`, used only by
  `-PinvoicemeTestBuild=true`. The `release-config` job in
  `android-test.yml` builds a production-mode APK and AAB and fails if
  either allows cleartext; the release workflow checks the same on every
  production artifact. Android blocks plain HTTP by default, so an `http://`
  server would not work with a production build.
- The app trusts only the system's certificate authorities (no custom network
  security configuration). The server must present a certificate a phone
  trusts: from a public CA (e.g. Let's Encrypt), or from a private CA that
  device management installs on the phones. A self-signed certificate will
  fail.
- **The owner decides, from their own knowledge of the installation:** the
  hostname phones use, how they reach it (LAN, VPN, internet), which
  component terminates TLS, and its certificate. This document does not
  assume anything about the warehouse setup; the server side is in
  [SERVER-RELEASE-CHECKLIST.md](../operations/SERVER-RELEASE-CHECKLIST.md)
  (HTTPS enforcement, `TRUST_PROXY`, `PUBLIC_ORIGIN`).

## 5. Test builds and their signing

`android-test.yml` builds the `.synctest` test APK on every pull request that
touches the app, and on demand (Run workflow, optional `api_base_url` for a
**test** backend; never a customer address, since this repository is public).

Two identities are possible:

| Mode | When | Consequence |
|---|---|---|
| Per-build identity (current) | no test key configured | Signed with that CI runner's throwaway debug key: **every run has a different key**, so a test APK cannot be installed over an earlier one; Android refuses the update |
| Stable test key | the test-key secrets below exist | Same key every run: later test APKs install over earlier ones (versionCode increases per run); still a separate `.synctest` app |

To set up the stable test key (once, on your machine, with a JDK as in 3.2;
a **different** key from the production key, never reuse it). Keep the
`.jks` and its passwords in your password manager like any key, but losing
it costs only test-build continuity:

```sh
keytool -genkeypair -v -keystore invoiceme-test.jks -alias invoiceme-test \
  -keyalg RSA -keysize 4096 -validity 3650 -dname "CN=InvoiceMe test builds"
keytool -list -v -keystore invoiceme-test.jks -alias invoiceme-test | grep SHA256
R=seifosmaan53/invoiceme
base64 -i invoiceme-test.jks | gh secret set ANDROID_TEST_KEYSTORE_BASE64 --repo $R
gh secret set ANDROID_TEST_KEYSTORE_PASSWORD --repo $R
gh secret set ANDROID_TEST_KEY_ALIAS --repo $R          # invoiceme-test
gh secret set ANDROID_TEST_KEY_PASSWORD --repo $R
gh variable set ANDROID_TEST_CERT_SHA256 --repo $R --body <SHA256>
gh variable set ANDROID_RELEASE_CERT_SHA256 --repo $R --body <production SHA256>   # recommended: refuse the production key here
```

The test workflow checks the test keystore's fingerprint **before** building:
it must equal `ANDROID_TEST_CERT_SHA256` and, when
`ANDROID_RELEASE_CERT_SHA256` is set in this repository, must differ from it.
Fingerprints are public values; the production key itself never comes here.

Repository secrets are not given to pull requests from forks; such PRs fall
back to the per-build identity. A partly configured test key fails the run.

After the secrets are set, start Actions > Android test candidate > Run
workflow (with `api_base_url` `http://127.0.0.1:3900/api/v1` for the
phone-test backend). Check that the run's `release-record.txt` shows
`signing_certificate_sha256` = your test fingerprint. From that build on,
each later test build installs over the previous one.

**The test APKs already produced cannot be updated by a stable-key build.**
They were signed with different throwaway keys (`72ae129`: `8170b77e…32ce`;
`849552b`: `dd265408…933b`; `ed065aa`: `f8ea52e2…c7bb`; the phone build of
`6c3c230`: `c9fd0dfe…82fc`), and no later build can carry those keys. A device that has one of them keeps it: let it sync,
and install new test builds on another device or emulator. Remove an old
test build only once you have confirmed it holds no unsynced changes, and
only if you choose to; nothing here requires removing it.

## 6. Checks that run automatically

| Check | Where | Proves |
|---|---|---|
| Release path with a throwaway key: APK and AAB, id from the property, required signing, no cleartext, https URL; refusals (missing key, wrong certificate, `http://` URL) | `android-test.yml` job `release-config` | The configuration and the verification script work; it is not a release and nothing is uploaded |
| Test APK identity, version, certificate; production checks refuse it (cleartext) | job `test-apk` | The test build stays a test build |
| On-device tests on an emulator against a real backend | job `emulator-e2e` | Database migration, a protocol-2 conflict flow, payment display |
| The release workflow itself | runs only in the private repository | Here it stops at the public-repository refusal |
