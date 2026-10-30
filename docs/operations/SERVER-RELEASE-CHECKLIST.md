# Server release checklist (authoritative)

The single checklist for updating an existing InvoiceMe server to the release
on `main` (`849552b` or later). Work through it in order and tick each item in
your private runbook. Detailed procedures are linked, mainly to
[customer-update.md](customer-update.md) ("CU") and
[upgrade-2026-10-28.md](upgrade-2026-10-28.md) ("UP"); where they differ, this
checklist wins.

Scope and rules:
- Owner-run. **Nothing in this repository has been run on, connected to, or
  verified against any real installation**, including the customer's
  warehouse installation, which the owner maintains privately. Its version,
  schema, data and backups are unverified until the owner checks them.
- Installation-specific details (hostnames, accounts, findings) belong in the
  private runbook, not here. Credentials go only into a password manager or
  encrypted storage, never chat, email or tickets.
- Read-only first; changes only inside an agreed maintenance window.
- **Never apply a SQL file just because a schema marker is missing.** The
  integrity report's markers are clues; the migration plan comes from the
  reviewed schema difference (step 4).

## Release order

Server first, then a pilot, then phones. Each stage starts only when the
previous one passed:

1. **Server** (steps 1-10 below) at the installation, by the owner:
   installation-specific compatibility review, verified backup and
   restore, migrations through 022 from the reviewed schema difference,
   configuration (timezone, HTTPS/proxy, API-key scopes, legacy cutoff
   **unset**, historical overdue e-mails **off** unless explicitly opted
   in), Stripe webhook, verification.
2. **Mobile acceptance**: owner-reported physical-phone testing of an
   earlier build; repeat testing of the current build declined by the owner
   (2026-10-30; docs/release/DEVICE-ACCEPTANCE.md). Automated emulator and
   host evidence covers the current app code. The pilot (step 11) is
   therefore the first time the current app runs on phones: keep it small
   and start with a test account and synthetic records.
3. **Production build** (docs/release/ANDROID-RELEASE.md) and **pilot**
   (step 11): one or two phones, synthetic or agreed test records on the
   updated server, before any real customer use.
4. **Rollout** to the remaining phones. Only then may a date for
   `SYNC_LEGACY_WRITE_CUTOFF` be set (step 5); until the mobile release
   date is confirmed it stays disabled.

If the server must be recovered at any point, step 10 applies: restore the
window backup and run the **new** version against it; never return to a
version without the security fixes. A protocol-2 app needs a protocol-2
server: hold the mobile rollout while the server is being recovered.

## 1. Identify the installation (read-only)
- [ ] Operating system, how the app is started, installation folder, what
      runs it (Docker, PM2, service, script), installed version, Node.js and
      PostgreSQL versions, where `.env` lives (keys only, no values), how
      clients and phones reach it (HTTP/HTTPS/proxy), existing backups,
      uploaded-file storage, browser for PDFs. *CU 1, rows 1-13.*
- [ ] Compatibility: the release needs **Node 20**; `DB_SYNCHRONIZE` must be
      absent or `false`; note the TLS arrangement and any `http://`
      bookmarks/devices (they matter for step 5).

## 2. Read-only access and a preparation copy
- [ ] The customer's administrator creates the read-only role (with
      sequence grants). *CU 2.*
- [ ] `pg_dump` preparation copy restored on the operator's machine (analysis
      only; it is not the recovery backup). *CU 3.*
- [ ] Integrity report on the copy; keep the output (exit 3 = not verified,
      never clean). If `encrypted_client_fields` lists any client, or is NOT
      CHECKED, keep `ENCRYPTION_KEY` exactly as it is. *CU 4.*

## 3. Backup and restore verification
- [ ] In the window, with the backend stopped: fresh `pg_dump`, roles if
      custom, uploaded files if S3/MinIO, `.env` and proxy/TLS files;
      SHA-256 of each. *CU 6.1-6.2.*
- [ ] Prove it: restore into a scratch database and run `verify-restore`
      (exit 0; exit 4 only after a person reviewed every EQUIVALENT pair),
      `verify-files` for uploads and `.env`. Stop here and restart the
      unchanged backend if anything fails. *CU 6.3.*

## 4. Migrations 018-022: reviewed, rehearsed, then applied
- [ ] `scripts/schema-review.sh` against the preparation copy; a person
      reviews `schema.diff` (tables, columns, types, constraints, enum
      values, every index definition, extra objects). *CU 5.1-5.2.*
- [ ] Written, installation-specific migration plan. Expected for an
      installation older than this release, in this order and only where the
      review shows they are missing:

      | File | Adds | Notes |
      |---|---|---|
      | `018_add_device_change_change_id.sql` | `device_changes.change_id` + unique index | Stops with a duplicate count if data needs a decision: record it and ask the owner; never edit data on your own |
      | `019_sync_revisions_conflicts.sql` | revisions, sync history, tombstones, conflicts, triggers | Server refuses sync writes (503) without its triggers |
      | `020_payment_events_and_state.sql` | refund/dispute state, provider event history | |
      | `021_sync_delivery_cursor.sql` | `change_txid` + updated trigger functions | After 019 |
      | `022_system_state.sql` | `system_state` (overdue first-run marker) | Without it the overdue check does not run at all |

      All are additive and idempotent. Run each with
      `psql -v ON_ERROR_STOP=1 --single-transaction -f <file>`. Anything that
      rewrites or drops data needs the owner's explicit approval. *CU 5.3, UP 2.*
- [ ] Rehearse the plan on a second restored copy, start the new release
      against it, run step 7's checks there; time each step. *CU 5.4.*
- [ ] In the window: apply exactly the rehearsed plan. *CU 6.5.*

## 5. Configuration (`backend/env.example` for every variable)
- [ ] `BUSINESS_TIMEZONE`: the IANA zone whose calendar decides "today" for
      issue/due dates, recurring runs and overdue checks (unset = the server
      process's `TZ`). An invalid name stops startup. *UP 1.3.*
- [ ] HTTPS and proxy: `NODE_ENV` and the TLS arrangement stay as they were;
      `TRUST_PROXY` names the proxy (`true` = same machine only; otherwise its
      address/subnet; `1`/`yes` stop startup); `API_HOST=127.0.0.1` with a
      same-machine proxy; the proxy overwrites `X-Forwarded-Proto` and
      `X-Forwarded-For`; `PUBLIC_ORIGIN`/`TRUSTED_HOSTS` if anything relied on
      the old plain-HTTP redirect. *CU 6.4.3.*
- [ ] Phones: a production app needs `https://<host>/api/v1` with a
      certificate the phones trust (public CA, or a private CA installed by
      device management). Decide the hostname phones use and how they reach
      it. *docs/release/ANDROID-RELEASE.md section 4.*
- [ ] API keys: keys created without permissions have **no** access (fail
      closed); review existing keys and give each only the permissions it
      needs (`read:invoices`, `write:invoices`, ..., `*` = everything). Only
      invoice and client routes accept keys. *docs/SECURITY.md "API keys".*
- [ ] Legacy sync: leave `SYNC_LEGACY_WRITE_CUTOFF` **unset** in this update.
      Older apps keep syncing with last-write-wins on drafts, clients and
      attachments (UP 4). Set a cutoff only after a protocol-2 app is
      released and installed on every phone (recommended 60 days later). *UP 6.*
- [ ] Overdue notifications: leave `OVERDUE_NOTIFY_HISTORICAL` unset (=
      `false`). The first overdue run then marks the historical backlog
      silently and emails only invoices due the day before; later runs email
      every invoice they mark. Set it to `true` before the first start only
      if the owner explicitly wants the backlog emailed; remove it after the
      first run. *UP 3.2.*
- [ ] Optional sync retention: `SYNC_RETENTION_DAYS` (400),
      `SYNC_CONFLICT_RETENTION_DAYS` (180) only if the defaults do not fit.

## 6. Install and start
- [ ] Install the CI-built bundle (verify `.sha256` and `SHA256SUMS`) into a
      **new** folder with the existing `.env`; `PUPPETEER_SKIP_DOWNLOAD=true
      npm ci --omit=dev` on Node 20. Docker: build from the merged commit,
      keep volumes and `.env`. *CU 6.4, 6.7, "The update package".*
- [ ] Start; the log shows the business timezone, the overdue setting
      (`Overdue backlog notifications on the first run: off`), and no
      "Migration 022 ... is not applied" or missing-trigger error.

## 7. Verify after the update
- [ ] `node healthcheck.js` exits 0. *CU 7.1.*
- [ ] A staff member signs in, opens existing invoices and clients, renders
      one PDF. *CU 7.2.*
- [ ] Integrity report on the live database (read-only role): 0 or the
      findings already seen in step 2; no NOT CHECKED. *CU 7.3.*
- [ ] Backend log clean; record bundle and backup checksums and results in
      the private runbook. *CU 7.4-7.5.*
- [ ] After the first midnight run: the log line `Marked N invoices as
      overdue; notified M; first run of this version: K historical invoices
      ... marked without notification` matches expectations.

## 8. Stripe (if online payments are used)
- [ ] Webhook endpoint `https://<server>/api/v1/webhooks/stripe` subscribed to
      the events listed in [PAYMENTS.md](../PAYMENTS.md) "Webhook endpoint
      setup"; signing secret in `STRIPE_WEBHOOK_SECRET`. Check with Stripe's
      test mode only.
- [ ] Known: refunds and disputes from before the update are not
      reconstructed; such invoices show `paid` until a later event for the
      same charge arrives (manual check in the Stripe Dashboard).

## 9. Optional: remove old Stripe client secrets
- [ ] Only after a verified backup taken after the update. **Dry run first**:
      `node dist/ops/scrub-payment-secrets.js` (exit 0 nothing to do, 2 rows to
      clean); then `--apply --i-have-a-verified-backup`; a final dry run exits
      0. Older backups, dumps and logs still contain the values; handle them
      under the retention policy. *CU "Removing stored Stripe client secrets".*

## 10. Recovery (fix forward)
- [ ] Before the new version serves: keep the backend stopped, diagnose, fix
      the configuration or bundle.
- [ ] If the database must be undone: restore the **window backup** from step
      3 (never the preparation copy) and start the **new** version against it
      once fixed. Running the old version again is an owner decision outside
      this procedure (it lacks the security fixes). *CU 8.*
- [ ] A protocol-2 app needs a protocol-2 server: hold the app release if
      the server is rolled back. *UP "Rollback".*

## 11. Mobile pilot (after step 7 passed)
- [ ] The production APK verified as in ANDROID-RELEASE.md 3.4 (checksum,
      id, version, certificate, no cleartext) and its line in the build
      ledger.
- [ ] Installed on one or two pilot phones that do not hold an earlier
      InvoiceMe build with unsynced work (DEVICE-ACCEPTANCE.md, "An earlier
      test build is on the phone").
- [ ] Pilot users sign in against the updated server's `https://` address;
      first with a test account and synthetic records, then the agreed
      pilot records. Check sign-in, sync (Settings > Data & Sync), an
      invoice PDF, and logout/sign-in of a second account on one phone.
- [ ] Watch the server log and the integrity report during the pilot.
- [ ] Wider rollout only after the pilot; `SYNC_LEGACY_WRITE_CUTOFF` stays
      unset until every phone runs the new app (step 5).

## Known limitations to tell the people using it
- Overdue emails: each invoice is emailed at most once, by the run that
  marks it. If the server stops between marking and sending, or a send
  fails, that email is **not retried** (there is no outbox).
- Older apps (protocol 1) overwrite server changes without a conflict, and
  can miss a write until a full resync; this ends when every phone runs a
  protocol-2 app (UP 4).
- No production mobile app has been released: phones keep their current app
  until the owner releases one (docs/release/RELEASE-HANDOFF.md).
