# Updating an on-site InvoiceMe installation

This procedure updates an InvoiceMe backend installed on a customer's own
computer (for example a warehouse PC) to a release that contains the security
fixes merged in `6dd9ad2` and later. It assumes nothing about the installation:
its version, schema, data and backups are treated as **unverified** until
checked. Nothing here may be run on the customer's machine without the
customer's authorisation and an agreed maintenance window.

Customer-specific details (who, where, hostnames, account names, findings)
do **not** belong in this public repository. Keep them in a private runbook.

Ground rules:

- Read-only first. Identification, the integrity report, the schema review
  and the restore verification never write to the live database.
- Back up and **prove the backup restores** before changing anything.
- Plan migrations from the **actual installed schema**, rehearse them on a
  restored copy, and only then apply them in the maintenance window.
- `DB_SYNCHRONIZE` stays unset or `false` on the customer's installation at
  all times. With `true`, TypeORM rewrites the schema to match the entities.
- Never repair, delete, reassign or quarantine records automatically. Every
  ownership finding goes to a person for review
  (`docs/security/2026-10-25-historical-cross-owner.md`).
- Keep credentials out of chat, email and tickets. Copy `.env` and keys only
  to encrypted storage.

## 1. Identify the installation (read-only, on site)

Record the answers in the private runbook. Start with the first three; they
tell you where to look for the rest.

| # | Question | How to find out (read-only) |
|---|---|---|
| 1 | Operating system and version | Windows: Settings > System > About, or `winver`. macOS: Apple menu > About This Mac. Linux: `cat /etc/os-release` |
| 2 | How the app is opened | The desktop/Start-menu shortcut, taskbar icon, startup item or command the staff use. Right-click the shortcut > Properties (Windows) and note **Target** and **Start in**; or note the command typed |
| 3 | Installation folder | The **Start in** folder or the folder in the command; list its top level (`dir` / `ls`). Look for `docker-compose.yml`, `package.json`, `dist/`, `backend/`, `VERSION.txt`, `.git/` |
| 4 | What actually runs | From the folder and the processes: Docker (`docker ps`), PM2 (`pm2 ls`), a Windows service (`Get-Service`), a scheduled task, or `node` started by a script |
| 5 | Installed version | `VERSION.txt` (update bundles), `git log -1` (checkouts), the image tag (Docker), otherwise file dates. `package.json` says `1.0.0` in every version and identifies nothing |
| 6 | Node.js | `node --version` (the release needs Node 20) |
| 7 | Database | PostgreSQL version (`psql --version`, or `SELECT version();`), whether it runs on the same machine, and the database name from `.env` (`DB_DATABASE`). Do not copy the password |
| 8 | Configuration | Where `.env` lives; whether it sets `NODE_ENV`, `TRUST_PROXY`, `DB_SYNCHRONIZE`, `ENCRYPTION_KEY`, `S3_BUCKET` (note yes/no, never values) |
| 9 | How clients reach it | Plain HTTP on the LAN, HTTPS directly, or through a TLS proxy (and which). With `NODE_ENV=production` the backend refuses plain HTTP except for the local health check |
| 10 | Existing backups | Tool or scheduled task, schedule, destination, newest backup's name/date/size. Do not move or rotate anything |
| 11 | Uploaded files | Only if `S3_BUCKET`/an S3 or MinIO endpoint is configured; attachments are stored there, not on disk |
| 12 | Browser for PDFs | Chrome/Chromium installed? Its path (needed for `PUPPETEER_EXECUTABLE_PATH` on Node installations) |
| 13 | User accounts | How many (`SELECT count(*) FROM users;` with the read-only role). With one account the cross-account flaw had no possible victim |

## 2. A read-only database role

The customer's administrator creates this role (a change to their database
server, so it needs their approval). Generate a strong password and hand it
over through a password manager:

```sql
CREATE ROLE invoiceme_audit LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE <database> TO invoiceme_audit;
GRANT USAGE ON SCHEMA public TO invoiceme_audit;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO invoiceme_audit;
ALTER ROLE invoiceme_audit SET default_transaction_read_only = on;
```

## 3. Backup and proof of restore (before any change)

Stop the backend first and keep it stopped until step 3.6 passes; the source
must be quiet for the comparison to prove anything. Leave every existing
backup where it is.

1. **Database.** `pg_dump -Fc -d <database> -f invoiceme-<date>.dump`. If the
   installation created its own database roles, also
   `pg_dumpall --globals-only > roles-<date>.sql` (password hashes: encrypt it).
2. **Uploaded files.** Only if S3/MinIO is configured: mirror the bucket to the
   backup medium (for example `mc mirror <alias>/<bucket> <backup>/uploads`).
3. **Configuration and keys.** Copy the installation's `.env` (and any proxy or
   TLS configuration and certificates) into encrypted storage.
   - `JWT_SECRET` / `JWT_REFRESH_SECRET`: losing them signs every user out; no
     data is lost.
   - `ENCRYPTION_KEY`: the current code never encrypts data at rest with it
     (only the GDPR export tries to decrypt, and passes plain text through).
     An older installed version might have. The integrity report's
     `encrypted_client_fields` line lists clients whose fields look encrypted;
     if it lists any, that key is required to read them and must be kept.
   - Database, SMTP and Stripe credentials.
4. **Record checksums** of every backup file (`shasum -a 256` / `certutil -hashfile <file> SHA256`).
5. **Restore** into a scratch database on another machine or under another
   name: `createdb invoiceme_restore_check && pg_restore --no-owner -d invoiceme_restore_check invoiceme-<date>.dump`.
6. **Verify, each part separately:**

   | What | Tool | It proves | It does not prove |
   |---|---|---|---|
   | Database | `node dist/ops/verify-restore.js` with `VERIFY_SOURCE_URL` (live, read-only role) and `VERIFY_RESTORED_URL` | Every table's rows (count + content hash), and the schema objects: columns, constraints, indexes, **sequence positions**, extensions, enum types, views, functions, triggers. Each side is read in one consistent read-only snapshot. Reports **NOT PROVEN** if other sessions are connected to the source or it records writes during the run | Roles and passwords, ownership and privileges, anything outside the `public` schema except extensions, files, configuration |
   | Uploaded files | `node dist/ops/verify-files.js <original-mirror> <backup-copy>` | Same relative paths, sizes and SHA-256 | That the mirror was complete at the source (compare the bucket's object count) |
   | Configuration | `node dist/ops/verify-files.js <live .env> <backed-up .env>` | Same keys, identical values (compared by hash, never printed) | That the values are correct, only that they are preserved |
   | Roles (if dumped) | review `roles-<date>.sql` | It exists and lists the expected roles | Passwords are usable |

   Exit code 0 from each tool is required. Anything else means the backup is
   not proven and the update must not proceed.
7. Keep the new backup on a separate medium from the existing ones.

A dump/restore round trip prints some `CHECK` constraints differently (casts
rearranged). `verify-restore` compares `CHECK` expressions without casts and
parentheses for that reason; `schema-review.sh` (step 5) shows them as a
cosmetic diff.

## 4. Integrity check (read-only)

Run against the **verified restore** (step 3) rather than the live database;
the result is the same and the live system is not touched:

```sh
INTEGRITY_DATABASE_URL='postgres://<user>:<password>@<host>/invoiceme_restore_check' \
  node dist/integrity/integrity-report.js
```

It reads the schema first. A check whose tables/columns are missing, or whose
query fails, is `[NOT CHECKED]`; exit code 3 means **not verified**, never
clean. Exit codes: 0 every check ran, no findings; 1 findings that need
review; 2 could not run; 3 not verified. The **schema fingerprint** it prints
(markers for migrations 001-017, origin guessed from index names) is a
diagnostic clue, not a migration history. Store the output with the private
runbook; it contains record ids.

## 5. Schema compatibility review (before planning any migration)

The security fixes need no schema change. Other migrations may be needed,
depending on how this installation's schema was created: by running some of
the SQL files by hand, or by TypeORM synchronize, or modified since. Decide
from the actual schema, not from the fingerprint:

1. On the operator's machine, against the verified restore:
   `scripts/schema-review.sh <restore-url> <scratch-server-url> <bundle>/migrations <out-dir>`.
   It builds a reference schema from this release's migrations in a temporary
   database and writes `installed.schema.sql`, `reference.schema.sql` and a
   normalised `schema.diff`. It decides nothing.
2. A person reviews `schema.diff` table by table: missing tables/columns,
   different types, constraints, indexes, enum values, and objects the
   reference does not have (views, triggers, extra tables). Note that the
   original migration `012` failed on every fresh database (fixed in this
   repository), so its indexes may be missing or created by hand.
3. Write an installation-specific migration plan: the exact statements, their
   order, and why each is needed. Prefer additive, idempotent statements
   (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Anything that
   rewrites or drops data needs the owner's explicit approval.
4. Rehearse the plan on a **second** restored copy: apply it with
   `psql -v ON_ERROR_STOP=1 --single-transaction`, then start the new release
   against that copy (step 6 verification) and rerun the integrity report,
   which must not report `NOT CHECKED`. Rerun `schema-review.sh` and confirm
   the remaining differences are the intended ones.
5. If no migration is needed, write that down too.

## 6. The update package

### Node installations (PM2, Windows service, scheduled task, started by hand)

The shipping bundle is built by CI (`.github/workflows/update-bundle.yml`) on
**Node 20** from the merged commit: `invoiceme-backend-<commit>.tar.gz` with a
`.sha256` file, attached to the workflow run as an artifact. The same workflow
installs that exact bundle on Ubuntu and Windows with Node 20, starts it
against PostgreSQL, checks health strictly and renders a PDF with the system
browser. Do not ship a bundle built anywhere else.

Contents: `dist/` (entry point `dist/main.js`), `healthcheck.js`,
`package.json`, `package-lock.json`, `migrations/*.sql`, `env.example`, these
docs, `VERSION.txt`, `SHA256SUMS`. No `node_modules`: `bcrypt` is native and
must be installed for the target operating system.

In the maintenance window, after steps 3-5:

1. Verify the bundle: `.sha256` against the archive, then `SHA256SUMS` inside it.
2. Extract into a **new** folder; leave the old folder untouched for reference.
3. Copy the existing `.env` into the new folder. Then:
   - keep `NODE_ENV`, `TRUST_PROXY` and the TLS arrangement exactly as they
     were (step 1, rows 8-9);
   - make sure `DB_SYNCHRONIZE` is absent or `false`;
   - add `PUPPETEER_EXECUTABLE_PATH=<browser path>` (row 12), e.g.
     `C:\Program Files\Google\Chrome\Application\chrome.exe`.
   If clients reach the backend through a TLS proxy that sets
   `X-Forwarded-Proto`, `TRUST_PROXY=true` is now **required**: this release
   ignores that header unless the proxy is trusted (earlier releases accepted
   it from anyone, which let any client bypass HTTPS enforcement).
4. Install dependencies with Node 20: `PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev`
   (PowerShell: `$env:PUPPETEER_SKIP_DOWNLOAD='true'; npm ci --omit=dev`).
   Needs the npm registry, or a prepared offline cache.
5. Apply the rehearsed migration plan from step 5, if any.
6. Point the shortcut/service/task at the new folder's `dist/main.js` and start it.

### Docker installations

Build the image from the merged commit (`docker build -t invoiceme-backend:<commit> ./backend`),
or transfer it with `docker save`/`docker load` and a verified checksum. Keep
the existing volumes and `.env` (same `NODE_ENV`/`TRUST_PROXY`, no
`DB_SYNCHRONIZE`), apply the rehearsed migration plan, and replace the
container. The image contains Chromium and sets `PUPPETEER_EXECUTABLE_PATH`.

## 7. Verify after the update

1. `node healthcheck.js` on the same machine (inside the container for
   Docker) exits 0. It requires HTTP 200 with `"status":"ok"` and
   `"database":"connected"`; a redirect, another status, other content or a
   timeout fails. In production the backend serves the health route over
   plain HTTP only to the local machine.
2. A staff member signs in with their own account, opens existing invoices
   and clients, and renders one invoice PDF.
3. The integrity report on the live database (read-only role) returns 0 or
   the same findings as before; it must not report `NOT CHECKED`.
4. The backend log shows no errors.
5. Record the bundle/image checksum, the backup checksums and the results in
   the private runbook.

Do not create test records in the customer's database unless the customer
agrees; the cross-account protections are verified in CI with synthetic users.

## 8. Expected downtime

From stopping the backend (step 3) until step 7 passes: backup, restore and
verification, dependency install, the rehearsed migrations, and checks. For a
small database expect roughly 30-60 minutes; time `pg_dump`/`pg_restore` on
the identification visit (they can run against a copy) and book a margin.

## 9. If something goes wrong: fix forward

The version installed before this update lacks the security fixes. Running it
again is **not** a recovery option.

- If the update fails before the new version is serving, keep the backend
  stopped, diagnose, and fix forward (corrected configuration or bundle).
- If the database was changed and must be undone, restore the verified
  backup from step 3 and start the **new** version against it once the
  problem is fixed.
- If one function misbehaves after the update (for example PDF rendering),
  keep the service running and ask staff to avoid that function until a
  fixed bundle is installed, or stop the service if the fault is broad.
- Restarting the previous version is an owner decision outside this
  procedure, with the risk written down.

Data repairs of any kind follow the operator-reviewed plan in
`docs/security/2026-10-25-historical-cross-owner.md`, against a verified
backup, never automatically.
