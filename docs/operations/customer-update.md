# Updating an on-site InvoiceMe installation

This procedure updates an InvoiceMe backend installed on a customer's own
computer (for example a warehouse PC) to a release that contains the security
fixes merged in `6dd9ad2` and later. It assumes nothing about the installation:
its version, schema, data and backups are treated as **unverified** until
checked. Nothing here may be run on the customer's machine without the
customer's authorisation, and the steps that stop the service only inside an
agreed maintenance window.

Customer-specific details (who, where, hostnames, account names, findings)
do **not** belong in this public repository. Keep them in a private runbook.

The work happens in three parts:

| Part | Where | Downtime |
|---|---|---|
| A. Preparation visit (sections 1-5) | read-only on site, then the operator's own machine | none |
| B. Maintenance window (section 6) | on site | yes |
| C. Recovery, only if needed (section 8) | on site | continues the window |

Ground rules:

- Read-only first. Identification, the integrity report, the schema review
  and the restore verification never write to the live database.
- Plan migrations from the **actual installed schema**, rehearse them on a
  restored copy, and only then apply them in the window.
- `DB_SYNCHRONIZE` stays unset or `false` on the customer's installation at
  all times. With `true`, TypeORM rewrites the schema to match the entities.
- Never repair, delete, reassign or quarantine records automatically. Every
  ownership finding goes to a person for review
  (`docs/security/2026-10-25-historical-cross-owner.md`).
- Keep credentials out of chat, email and tickets. Copy `.env` and keys only
  to encrypted storage.

## A. Preparation visit (no downtime)

### 1. Identify the installation (read-only)

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
| 8 | Configuration | Where `.env` lives; whether it sets `NODE_ENV`, `TRUST_PROXY`, `PUBLIC_ORIGIN`, `TRUSTED_HOSTS`, `API_PORT`, `API_HOST`, `DB_SYNCHRONIZE`, `ENCRYPTION_KEY`, `S3_BUCKET` (yes/no and non-secret values only) |
| 9 | How clients reach it | Plain HTTP on the LAN, HTTPS directly, or through a TLS proxy (which product, on which machine, and whether the backend's port is also reachable directly from the LAN). With `NODE_ENV=production` the backend refuses plain HTTP except for a local health check |
| 10 | Existing backups | Tool or scheduled task, schedule, destination, newest backup's name/date/size. Do not move or rotate anything |
| 11 | Uploaded files | Only if `S3_BUCKET`/an S3 or MinIO endpoint is configured; attachments are stored there, not on disk |
| 12 | Browser for PDFs | Chrome/Chromium installed? Its path (needed for `PUPPETEER_EXECUTABLE_PATH` on Node installations) |
| 13 | User accounts | How many (`SELECT count(*) FROM users;` with the read-only role). With one account the cross-account flaw had no possible victim |

### 2. A read-only database role

The customer's administrator creates this role (a change to their database
server, so it needs their approval). Generate a strong password and hand it
over through a password manager:

```sql
CREATE ROLE invoiceme_audit LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE <database> TO invoiceme_audit;
GRANT USAGE ON SCHEMA public TO invoiceme_audit;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO invoiceme_audit;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO invoiceme_audit;
ALTER ROLE invoiceme_audit SET default_transaction_read_only = on;
```

Without the sequence grant the restore verification cannot read sequence
positions and reports NOT PROVEN.

### 3. A preparation copy of the database

`pg_dump -Fc -d <database> -f invoiceme-prep-<date>.dump` with the read-only
role. `pg_dump` reads one consistent snapshot, so the backend can keep
running. Take the file to the operator's machine (encrypted) and restore it
there: `createdb invoiceme_prep && pg_restore --no-owner -d invoiceme_prep invoiceme-prep-<date>.dump`.
This copy is for analysis and rehearsal only. It is **not** the recovery
backup; that is taken in the window (section 6.2).

### 4. Integrity check (read-only, on the copy)

```sh
INTEGRITY_DATABASE_URL='postgres://<user>@localhost/invoiceme_prep' node dist/integrity/integrity-report.js
```

It reads the schema first. A check whose tables/columns are missing, or whose
query fails, is `[NOT CHECKED]`; exit code 3 means **not verified**, never
clean. Exit codes: 0 every check ran, no findings; 1 findings that need
review; 2 could not run; 3 not verified. The **schema fingerprint** it prints
(markers for migrations 001-019, origin guessed from index names) is a
diagnostic clue, not a migration history. The info line
`encrypted_client_fields` lists clients whose fields look encrypted; if it
lists any, or if it is NOT CHECKED, keep `ENCRYPTION_KEY` exactly as it is.
Store the output with the private runbook; it contains record ids.

### 5. Schema compatibility review and rehearsal

The security fixes need no schema change. The sync contract fix needs
migration `018_add_device_change_change_id.sql` (additive, idempotent, no
data change) **before** the new server starts; if it stops with
`migration 018: device_changes has N duplicate (user_id, change_id)
group(s)`, do not edit data on your own: record the output and ask the owner
(see `docs/SYNC-CONTRACT.md`, "Compatibility and rollout"). Sync protocol 2
then needs migration `019_sync_revisions_conflicts.sql` (additive,
idempotent; adds revision columns, three sync tables and the revision and
tombstone triggers) **before** the new server starts; the server reads the
new columns on every client, invoice and item query. After applying it, the
server checks the triggers itself at startup and refuses sync writes (503) if
they are missing; a fingerprint marker alone does not prove the triggers
exist. Keep `DB_SYNCHRONIZE` unset for upgrades. Other migrations
may be needed, depending on how this installation's schema was created (some SQL files run
by hand, TypeORM synchronize, or later edits). Decide from the actual schema:

1. On the operator's machine:
   `scripts/schema-review.sh <prep-copy-url> <scratch-server-url> <bundle>/migrations <out-dir>`
   (`<scratch-server-url>` is a `postgres://user@host:port/database` URL on a
   server where a temporary database may be created). It builds a reference
   schema from this release's migrations and writes `installed.schema.sql`,
   `reference.schema.sql`, a normalised `schema.diff` and a log. It decides
   nothing.
2. A person reviews `schema.diff`: missing tables/columns, types, constraints,
   enum values, and every index **definition**, not only its name (an index
   created by hand can have the right name and the wrong predicate; the
   original migration `012` failed on every fresh database and was fixed in
   this repository). Also objects the reference does not have (views,
   triggers, extra tables). A dump round trip prints some `CHECK` rules with
   casts rearranged; those lines are cosmetic.
3. Write an installation-specific migration plan: the exact statements, their
   order and why each is needed. Prefer additive, idempotent statements.
   Anything that rewrites or drops data needs the owner's explicit approval.
4. Rehearse on a second restored copy: apply the plan with
   `psql -v ON_ERROR_STOP=1 --single-transaction`, start the new release
   against that copy, run the section 7 checks and the integrity report (no
   `NOT CHECKED`), and rerun `schema-review.sh` to confirm the remaining
   differences are intended. Time each step; the window is planned from these
   timings.
5. If no migration is needed, write that down too.

## B. Maintenance window

### 6. Update

Have ready: the verified bundle or image, the written migration plan, the
timings, and an encrypted backup medium separate from the existing backups.

1. **Stop the backend** (and anything else writing to the database). Confirm
   no client sessions remain:
   `SELECT count(*) FROM pg_stat_activity WHERE datname = '<database>' AND pid <> pg_backend_pid() AND backend_type = 'client backend';`
2. **Fresh recovery backup:**
   - database: `pg_dump -Fc -d <database> -f invoiceme-<date>.dump`; if the
     installation created its own roles, `pg_dumpall --globals-only > roles-<date>.sql`
     (password hashes: encrypt it);
   - uploaded files, only if S3/MinIO is configured: mirror the bucket;
   - configuration: copy `.env` and any proxy/TLS configuration and
     certificates. Keep `JWT_SECRET`/`JWT_REFRESH_SECRET` (losing them signs
     everyone out), `ENCRYPTION_KEY` (see section 4), and the database, SMTP
     and Stripe credentials;
   - record SHA-256 checksums (`shasum -a 256` / `certutil -hashfile <file> SHA256`).
3. **Prove it while the source is still quiet:** restore into a scratch
   database (`createdb invoiceme_restore_check && pg_restore --no-owner -d invoiceme_restore_check invoiceme-<date>.dump`)
   and run each check below. Every one must exit 0; otherwise stop here, start
   the backend again unchanged, and investigate. `verify-restore` exits 4 when
   the only differences are constraint definitions shown as EQUIVALENT: a
   person compares each listed pair (a dump round trip re-prints some `CHECK`
   rules with text casts rearranged) and, if they are the same rule, reruns it
   with `VERIFY_ACCEPT_EQUIVALENT=true`.

   | What | Tool | It proves | It does not prove |
   |---|---|---|---|
   | Database | `node dist/ops/verify-restore.js` with `VERIFY_SOURCE_URL` (live, read-only role) and `VERIFY_RESTORED_URL` | Every table's rows (count + per-row hashes, from one MVCC snapshot, with output settings pinned), and the schema objects: columns, constraints, indexes, sequence positions, extensions, enum types, views, functions, triggers. Constraint text that differs only in casts/redundant parentheses is shown as EQUIVALENT for review. Reports NOT PROVEN if another session is connected to the source, the source records writes during the run, or the role cannot read a table or sequence | Sequence positions and definitions come from the catalog (they rely on the quiet source, step 1). Roles and passwords, ownership and privileges, anything outside `public` except extensions, files, configuration |
   | Uploaded files | `node dist/ops/verify-files.js <original-mirror> <backup-copy>` | Same relative paths, sizes and SHA-256; symbolic links are reported, not followed | That the mirror was complete at the source (compare the bucket's object count) |
   | Configuration | `node dist/ops/verify-files.js <live .env> <backed-up .env>` | Identical file, or same keys with identical values (multi-line values included). Values are never printed; a key is named only when present in both files with different values, everything else is counted | That the values are correct, only that they are preserved |
   | Roles (if dumped) | review `roles-<date>.sql` | It exists and lists the expected roles | That passwords are usable |

4. **Install the release** (Node installations; Docker: section 6.7):
   1. verify the bundle (`.sha256` against the archive, then `SHA256SUMS`);
   2. extract into a **new** folder; leave the old folder untouched;
   3. copy the existing `.env` into it and check:
      - `NODE_ENV`, `API_PORT` and the TLS arrangement stay as they were;
      - `DB_SYNCHRONIZE` is absent or `false`;
      - `PUPPETEER_EXECUTABLE_PATH=<browser path>` (row 12), e.g.
        `C:\Program Files\Google\Chrome\Application\chrome.exe`;
      - proxy settings, if clients come through a TLS proxy (row 9):
        `TRUST_PROXY` now names the proxy. `true` trusts only a proxy on the
        same machine; a proxy on another machine is named by address or
        subnet (`TRUST_PROXY=10.0.0.5`). The only accepted values are: absent,
        `false`, `true`, or addresses/subnets; anything else (`1`, `yes`) now
        stops the backend at startup, so check this before starting. With a
        same-machine proxy, set `API_HOST=127.0.0.1` so the backend cannot
        be reached except through the proxy. If the backend's port stays
        reachable from the LAN, do not trust that proxy by address range
        broader than the proxy itself. The proxy must **overwrite**
        `X-Forwarded-Proto` and `X-Forwarded-For` (nginx:
        `proxy_set_header X-Forwarded-Proto $scheme;`,
        `proxy_set_header X-Forwarded-For $remote_addr;`). Earlier releases
        accepted `X-Forwarded-Proto` from any client, which let anyone bypass
        HTTPS enforcement. `TRUST_PROXY=true` trusts every program on that
        machine, so if staff or other software on it are not trusted, give
        the proxy its own address and name that instead (docs/SECURITY.md);
      - redirect of plain HTTP (behaviour change in this release): with
        `NODE_ENV=production`, a plain-HTTP GET used to be redirected to
        `https://<Host header>`; it is now redirected only to `PUBLIC_ORIGIN`
        (e.g. `PUBLIC_ORIGIN=https://invoices.<customer domain>`; https,
        no path) or to a Host listed in `TRUSTED_HOSTS`, and otherwise
        refused with 403 "HTTPS required". Nothing new is required to start.
        Find out in section 1 (row 9) whether any browser bookmark, shortcut
        or device opens the backend over `http://` and relies on that
        redirect; if so, set `PUBLIC_ORIGIN` to the address they should end
        up at, or point them at `https://` directly. A malformed
        `PUBLIC_ORIGIN` or `TRUSTED_HOSTS` stops the backend at startup, so
        check it before starting. The local health check (`healthcheck.js`)
        is unaffected;
   4. install dependencies with Node 20: `PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev`
      (PowerShell: `$env:PUPPETEER_SKIP_DOWNLOAD='true'; npm ci --omit=dev`).
      Needs the npm registry, or a prepared offline cache.
5. **Apply the rehearsed migration plan**, if any, exactly as rehearsed.
6. **Start** the shortcut/service/task pointed at the new folder's `dist/main.js`.
7. **Docker installations:** build the image from the merged commit (or
   `docker load` a saved image with a verified checksum), keep the existing
   volumes and `.env` (same rules as 6.4.3), apply the plan, replace the
   container. The image contains Chromium and sets `PUPPETEER_EXECUTABLE_PATH`.

### 7. Verify after the update

1. `node healthcheck.js` in the new folder (inside the container for Docker)
   exits 0. It requires exactly HTTP 200 with `"status":"ok"` and
   `"database":"connected"`; a redirect, another status, other content or a
   timeout fails. It reads `API_PORT` from the environment or the `.env` in
   its own folder (start the backend from that folder too), and checks
   `127.0.0.1`, so with `API_HOST` set to a specific LAN address pass the URL:
   `node healthcheck.js http://<that address>:<port>/api/v1/health`. In production the backend answers the health route over plain HTTP
   only to a local client sending no forwarding headers, so requests relayed
   by a proxy are not exempt.
2. A staff member signs in with their own account, opens existing invoices
   and clients, and renders one invoice PDF.
3. The integrity report on the live database (read-only role) returns 0 or
   the findings seen in section 4; it must not report `NOT CHECKED`.
4. The backend log shows no errors.
5. Record the bundle/image checksum, the backup checksums and the results in
   the private runbook.

Do not create test records in the customer's database unless the customer
agrees; the cross-account protections are verified in CI with synthetic users.

Expected downtime: from step 6.1 to section 7, i.e. the window backup, its
restore and verification, dependency install, the rehearsed migrations and
checks, using the timings measured in section 5.4, plus a margin. For a small
database this is typically 30-60 minutes.

### The update package

The shipping bundle is built by CI (`.github/workflows/update-bundle.yml`) on
**Node 20** from the merged commit: `invoiceme-backend-<commit>.tar.gz` with a
`.sha256`, attached to the workflow run as an artifact. The same workflow
installs that exact bundle on Ubuntu and Windows with Node 20, applies the SQL
migrations, starts it in production mode, checks health strictly and HTTPS
enforcement (including a spoofed header), runs the integrity report, verifies
a dump/restore of seeded data (NOT PROVEN while another session is connected,
OK once quiet), and renders PDFs with the system Chrome. Do not ship a bundle
built anywhere else.

Contents: `dist/` (entry point `dist/main.js`), `healthcheck.js`,
`package.json`, `package-lock.json`, `migrations/*.sql`,
`scripts/schema-review.sh`, `env.example`, these docs, `VERSION.txt`,
`SHA256SUMS`. No `node_modules`: `bcrypt` is native and is installed for the
target operating system.

## C. If something goes wrong: fix forward

The version installed before this update lacks the security fixes. Running it
again is **not** a recovery option.

### 8. Recovery

- If the update fails before the new version is serving, keep the backend
  stopped, diagnose, and fix forward (corrected configuration or bundle).
- If the database was changed and must be undone, restore the **window
  backup** from step 6.2 (taken with the backend stopped, so no writes are
  lost) and start the **new** version against it once the problem is fixed.
  Never restore the preparation copy from section 3: it is older and would
  lose the writes made since.
- If one function misbehaves after the update (for example PDF rendering),
  keep the service running and ask staff to avoid that function until a
  fixed bundle is installed, or stop the service if the fault is broad.
- Restarting the previous version is an owner decision outside this
  procedure, with the risk written down.

Data repairs of any kind follow the operator-reviewed plan in
`docs/security/2026-10-25-historical-cross-owner.md`, against a verified
backup, never automatically.
