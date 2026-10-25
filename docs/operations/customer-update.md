# Updating an on-site InvoiceMe installation

This procedure updates an InvoiceMe backend installed on a customer's own
computer (for example a warehouse PC) to a release that contains the security
fixes merged in `6dd9ad2` and later. It is written for an installation whose
version, schema, data and backups have **not** been verified. Nothing here may
be run on the customer's machine without the customer's authorisation and an
agreed maintenance window.

Customer-specific details (who, where, hostnames, account names, findings) do
**not** belong in this public repository. Keep them in a private runbook.

Ground rules:

- Read-only first. Identification, the integrity report and restore
  verification never write to the live database.
- Back up and **prove the backup restores** before changing anything.
- Never repair, delete, reassign or quarantine records automatically. Every
  ownership finding goes to a person for review
  (`docs/security/2026-10-25-historical-cross-owner.md`).
- Never point a development tool at the customer database with
  `DB_SYNCHRONIZE=true`: TypeORM would alter the schema to match the entities.
- Keep credentials out of chat, email and tickets. Copy `.env` and keys only to
  encrypted storage.

## 1. Identify the installation (read-only)

Answer these before preparing anything installation-specific:

| Question | How to find out (read-only) |
|---|---|
| Operating system | Windows: `winver`; macOS: `sw_vers`; Linux: `cat /etc/os-release` |
| How the backend runs | Docker: `docker ps`; PM2: `pm2 ls`; Windows service: `Get-Service *invoice*`, or Task Scheduler / a startup shortcut; otherwise ask how it is started |
| Install folder and version | the folder the service starts from; `VERSION.txt` if it came from an update bundle; `git log -1` if it is a checkout; otherwise the folder's date |
| Node.js | `node --version` (the backend needs Node 20) |
| Database | `SELECT version();` and the database name from the installation's `.env` (`DB_DATABASE`). Do not copy the password anywhere |
| Schema version | the integrity report's schema fingerprint (section 3) |
| Existing backups | the backup tool or scheduled task, its schedule, destination, and the newest backup's name, date and size |
| Uploaded files | whether `S3_BUCKET` / an S3 or MinIO endpoint is configured in `.env` (attachments are stored there, not on disk) |
| Encryption key | whether `ENCRYPTION_KEY` is set in `.env` (yes/no only, never the value) |
| User accounts | how many accounts exist (`SELECT count(*) FROM users;`). With one account the cross-account flaw had no possible victim; with several it may have |
| Browser for PDFs | whether Chrome or Chromium is installed, and its path |
| `NODE_ENV` and TLS | the `NODE_ENV` value, and whether a TLS proxy or certificate fronts the backend. With `NODE_ENV=production` the backend redirects plain HTTP to HTTPS and refuses non-GET requests over HTTP, so the update must keep the same arrangement or the clients stop working |

## 2. A read-only database role

The customer's administrator creates this role (it is a change to their
database server, so it needs their approval). Use a strong generated password
and give it to the operator through a password manager, not in chat:

```sql
CREATE ROLE invoiceme_audit LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE <database> TO invoiceme_audit;
GRANT USAGE ON SCHEMA public TO invoiceme_audit;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO invoiceme_audit;
ALTER ROLE invoiceme_audit SET default_transaction_read_only = on;
```

## 3. Integrity check and schema fingerprint (read-only)

From an update bundle (section 5) or a checkout of this repository:

```sh
INTEGRITY_DATABASE_URL='postgres://invoiceme_audit:<password>@<host>:5432/<database>' \
  node dist/integrity/integrity-report.js        # bundle
# or: npm run integrity:report                    # checkout (backend/)
```

It reads the live schema first and prints:

- **Schema markers present/absent** for the SQL migrations `001`-`017` and the
  schema's origin (`sql-migrations` or `typeorm-synchronize`, from index
  names). Marker `012` is index-only and never appears in a schema built by
  TypeORM synchronize. A `WARNING` means the database does not look like
  InvoiceMe's at all.
- One line per check: `[OK]`, `[FINDING]`, `[INFO]`, or `[NOT CHECKED]` with the
  missing table/column or the query error.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | every check ran, no findings |
| 1 | findings that need review (see the historical cross-owner document) |
| 2 | the report could not run (connection, permissions) |
| 3 | **not verified**: nothing was found, but at least one check could not run on this schema. Never treat this as clean |

Store the output with the private runbook. It contains record ids.

Prefer running the report against the **verified restore** (section 4) rather
than the live database: the result is the same and the live system is not
touched.

## 4. Backup and restore verification (before any change)

Stop the backend first so the database is quiet (users cannot work during
this step; it is part of the maintenance window). Leave every existing backup
where it is; do not rotate or delete anything.

1. **Database.** `pg_dump -Fc -d <database> -f invoiceme-<date>.dump`
   (custom format, includes schema and data). Also save the database's roles
   if the installation created its own: `pg_dumpall --globals-only` (contains
   password hashes: encrypt it).
2. **Uploaded files.** Only if `.env` configures S3/MinIO: copy the bucket
   (for example `mc mirror <alias>/<bucket> <backup-folder>`). Otherwise there
   are no uploaded files on disk to back up.
3. **Configuration and keys.** Copy the installation's `.env` into encrypted
   storage. It holds `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`,
   database, SMTP and Stripe credentials. `ENCRYPTION_KEY` encrypts client
   email, phone and notes: the updated backend must use the **same** value, or
   those fields become unreadable. If it was never set, the code's built-in
   development key was used; keep it unset for the update and plan a separate,
   reviewed key rotation.
4. **Prove the restore.** Restore into a scratch database (another machine, or
   a different database name on the same server), then compare:

   ```sh
   createdb invoiceme_restore_check
   pg_restore --no-owner -d invoiceme_restore_check invoiceme-<date>.dump
   VERIFY_SOURCE_URL='postgres://invoiceme_audit:<pw>@<host>/<database>' \
   VERIFY_RESTORED_URL='postgres://<user>:<pw>@<host>/invoiceme_restore_check' \
     node dist/ops/verify-restore.js
   ```

   It compares every table's row count and content hash, read-only on both
   sides, and refuses to compare a database with itself. Exit 0 = the restore
   matches; anything else means the backup is not proven and the update must
   not proceed.
5. Keep the new backup on a separate medium from the existing ones, and record
   its checksum (`shasum -a 256 invoiceme-<date>.dump`).

## 5. The update package

### Node installations (PM2, Windows service, started by hand)

Build the bundle on a development machine from the commit to ship:

```sh
scripts/make-update-bundle.sh            # writes release/invoiceme-backend-<commit>.tar.gz + .sha256
```

It contains `dist/` (entry point `dist/main.js`), `package.json`,
`package-lock.json`, `migrations/*.sql`, `env.example`, these docs,
`VERSION.txt` and `SHA256SUMS`. It does not contain `node_modules` (`bcrypt`
is a native module and must be installed for the target operating system).

On the customer machine, in the maintenance window:

1. Verify the bundle checksum against the `.sha256` file.
2. Stop the backend. Complete section 4 (backup and proven restore).
3. Extract the bundle into a **new** folder; keep the old folder untouched for
   reference.
4. Copy the existing `.env` into the new folder. Add
   `PUPPETEER_EXECUTABLE_PATH=<path to Chrome/Chromium>` (Windows example:
   `C:\Program Files\Google\Chrome\Application\chrome.exe`). The PDF code uses
   this browser; Puppeteer's own download is skipped.
5. Install dependencies: `PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev`
   (Windows PowerShell: `$env:PUPPETEER_SKIP_DOWNLOAD='true'; npm ci --omit=dev`).
   Needs internet access to the npm registry, or a prepared offline cache.
6. Schema: the security fixes need **no** schema change. Apply only migrations
   the fingerprint reported absent, in order, each in one transaction:
   `psql -v ON_ERROR_STOP=1 --single-transaction -d <database> -f migrations/0NN_*.sql`.
   The original `012` failed on every fresh database (it used a non-existent
   status value) and was corrected in this repository; if the fingerprint shows
   `012` absent on a schema built from the SQL files, apply the corrected file
   (all its statements are `IF NOT EXISTS`). Migrations that create tables are
   not needed for a schema built by TypeORM synchronize. Re-run the integrity
   report afterwards; it must not report `NOT CHECKED`.
7. Point the service (PM2, Windows service, shortcut) at the new folder's
   `dist/main.js` and start it.

### Docker installations

Build the image from the commit to ship (`docker build -t invoiceme-backend:<commit> ./backend`).
For a machine without internet access, transfer it with `docker save` /
`docker load` and verify the archive's checksum. The image's health check calls
`/api/v1/health` (earlier images called `/api/health`, which does not exist, so
their health status was never meaningful). Keep the existing volumes and
`.env`; follow steps 2, 6 and 7 above with the container in place of the
folder. The image already contains Chromium and sets
`PUPPETEER_EXECUTABLE_PATH`.

## 6. Verify after the update

1. `GET /api/v1/health` returns 200 with `"database":"connected"`. With
   `NODE_ENV=production` the backend redirects plain-HTTP requests to HTTPS
   (301) and refuses non-GET requests over HTTP, so call it the way clients
   reach it (through the TLS proxy, or over HTTPS).
2. The operator signs in with their own account, opens existing invoices and
   clients, and renders one invoice PDF.
3. The integrity report returns 0, or the same findings as before the update
   (the update does not change data).
4. Review the backend log for errors.
5. Record what was done, the bundle/image checksum and the backup checksum in
   the private runbook.

Do not create test records in the customer's database unless the customer
agrees. The cross-account protections are verified in CI with synthetic users.

## 7. Expected downtime

The backend is unavailable from step 2 (stop) until verification passes:
backup + restore proof + dependency install + migrations + checks. For a small
database expect roughly 30-60 minutes; measure `pg_dump` and `pg_restore` time
during the identification visit and schedule the window with a margin.

## 8. If something goes wrong: fix forward

The version installed before this update lacks the security fixes. Running it
again is **not** a recovery option.

- If the update fails before the new version is serving, keep the backend
  stopped, diagnose, and fix forward (a corrected bundle or configuration).
- If the database was changed (migrations) and must be undone, restore the
  verified backup from section 4 and start the **new** version against it
  once the problem is fixed.
- If one function misbehaves after the update (for example PDF rendering),
  keep the service running and tell the users to avoid that function until a
  fixed bundle is installed, or stop the service if the fault is broad.
- Restarting the previous version is an owner decision outside this
  procedure, with the risk written down.

Data repairs of any kind follow the operator-reviewed plan in
`docs/security/2026-10-25-historical-cross-owner.md`, against a verified
backup, never automatically.
