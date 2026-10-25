# Historical cross-owner data (2026-10-25)

- **Branch:** `security/sync-ownership`, on top of `07ca855` (not pushed: this session has no git remote)
- **Follows:** `2026-10-25-sync-ownership.md` (its §6 items 1 and 3) and `2026-10-25-sync-ownership-REVIEW.md` (follow-up 1)
- **Status:** code and tests on the branch. Not merged, not deployed. **No data was modified anywhere.**

## 0. What is and isn't known

**The state of production data is unknown.** I have no access to any deployed
database and did not connect to one. Everything below was run against a
disposable local PostgreSQL 16 cluster with synthetic users only.

The sync-ownership report found that a `main.ts` deployment rejected every
sync push with 400, which would have blocked the old exploit. That report
could not confirm what the deployment actually runs. So production may hold
zero rows of the kinds below, or some. Only running the report in §4 against
it will tell.

This document keeps three things apart:

| | What | Where |
|---|---|---|
| **A** | Stop **new** invalid relationships | §1, commit `0f957de` |
| **B** | Stop **existing** invalid relationships from disclosing data | §2, commit `84818d4` |
| **C** | Find and (later, by decision) repair existing rows | §3–§6, commit `76c5f80`; nothing executed |

Timestamps and sync conflict resolution are out of scope here.

## 1. A: write paths that set a foreign key or an owner

Every REST write path was read. Sync push was already fixed on this branch.

| Path | Foreign key / owner | Before | Now |
|---|---|---|---|
| `POST /v1/invoices` | `clientId` | checked (`invoices.service.ts` `create`) | unchanged, test added |
| `POST /v1/invoices/import/csv` | `clientId` per row | goes through `create`, checked | unchanged, test added |
| `PATCH /v1/invoices/:id` | `clientId` | checked, but the eager `client` relation won on save, so re-pointing to an own client **did not persist** | relation replaced too. This is the owner's repair path, so it matters for §6 |
| `PATCH /v1/invoices/:id` items | `invoiceId` | always the invoice being updated (owner checked) | unchanged |
| `POST /v1/invoices/:id/duplicate`, `/convert` | copies `clientId` from the source | **not checked**: duplicating a legacy A→B-client invoice created a new one | 400 unless the client belongs to the user (archived own clients allowed) |
| `POST /v1/invoices/:id/attachments` | `ownerId` | the invoice id after the owner check | unchanged |
| `POST /v1/invoices/:id/pay` → `payments` | `invoiceId` | the invoice id after the owner check | unchanged |
| Stripe webhooks → `payments` | looks up by `providerPaymentId` | not reachable with a user-chosen id | not changed (the review noted it, not re-reviewed) |
| `PATCH /v1/invoice-templates/:id` | `userId`, `id` | **body untyped**, so even the `main.ts` `ValidationPipe` doesn't filter it. `Object.assign` let a body set `userId` (move the template into another account) or `id` (save then overwrote another user's template) | only template fields copied |
| `POST /v1/invoice-templates` | `userId` | from the JWT | unchanged |
| `PATCH /v1/clients/:id` | `userId`, `id` | not in the DTO; rejected by the `main.ts` pipe (`forbidNonWhitelisted`), but **without that pipe** `Object.assign` let a body set them | stripped in the service |
| `POST /v1/clients`, CSV import, bulk archive | `userId` | from the JWT; bulk archive scoped by `userId` | unchanged |
| Recurring invoices | `clientId` | no REST write path exists; the cron creates through `InvoicesService.create`, which checks the client | unchanged |
| User settings, API keys, feedback, GDPR delete | `userId` | from the JWT, explicit fields | unchanged |

Severity notes, from evidence only:

- **The template one is live in a `main.ts` deployment.** The regression test
  drives it through an app with the exact `main.ts` pipe options. It failed
  before (`a.userId` became user B's id) and passes after.
- The client one only applies without the `main.ts` pipe (for example, the
  E2E harness). It's defence in depth.

## 2. B: read paths that embed or follow a relation

The rule is: never return, render, email or notify with a record whose owner
differs from the requesting user.

### Which relations are detectable

- **Invoice → client, recurring invoice → client.** Both rows have `user_id`,
  so a mismatch is visible in the data itself.
- **Invoice item → invoice, attachment → invoice/client.** These rows have
  **no owner column**: their owner *is* whatever they point at. A
  cross-owner item or attachment looks normal in the tables. It only shows
  in `device_changes`, as an applied sync change (`synced = true`) by a user
  other than the current owner.
  - Rejected pushes are logged too (`synced = false`) and are deliberately
    ignored. Otherwise an attacker could hide a victim's records by pushing
    changes that fail. A test covers this.
  - Sync **deletes** by another user are also ignored (review finding F1,
    fix `d097b97`). Sync accepts a delete for an id that does not exist yet,
    so counting deletes would let a user hide another user's later record
    that happens to reuse that id. A delete never plants a record, so
    ignoring it cannot hide a real cross-owner write. A test covers this.
  - Limits: records created over REST have no `device_changes` row. So if
    the old push moved a victim's REST-created item into the attacker's
    invoice, the database shows no trace, except an `update` that set
    `invoiceId` (the report's `relation_repointed_by_sync`, which doesn't
    record the previous value).
- **Payments → invoice.** No owner column, and no path ever let a user
  choose `invoice_id` (§1). Sync has no payment type. No check was added
  beyond the invoice's own.

### Per-path decision

| Path | Foreign client | Item/attachment with another user's sync history |
|---|---|---|
| `GET /v1/invoices` (list) | **omitted**: the join only matches the owner's client, so `client: null`. Search no longer matches the other user's client name/email (it did before: a search oracle) | items not loaded |
| `GET /v1/invoices/:id` | **omitted** (`client: null`; `clientId` still returned, see below) | **omitted** |
| `POST /v1/invoices/:id/pdf` | **refused** with 400 and a message to assign an own client. Nothing is rendered: an invoice PDF without a bill-to would be wrong, and the endpoint already refused client-less invoices | **omitted** from the rendered items |
| `POST /v1/invoices/:id/send` | **refused** with 400. No PDF, no email to the other user's client, no "sent" notification | **omitted** |
| `POST /v1/invoices/:id/duplicate`, `/convert` | **refused** (A) | **not copied** |
| `GET /v1/invoices/:id/attachments` | n/a | **omitted** |
| `GET /v1/invoices/export/csv` | **omitted** (empty client columns) | n/a |
| `GET /v1/gdpr/export` | it never output client fields, only `clientId`. Verified: the "A's export" assertions passed on the old code. The relation is no longer loaded | **omitted** from `items` |
| `GET /v1/sync/pull` | omitted (already, `fae3a48`) | **omitted** from `invoiceItems` and `attachments` |
| Paid notice (detail view recomputing status), payment-received (webhook), overdue (cron) | client name **omitted** (`Unknown`, or no paid notice, as for any client-less invoice) | n/a |
| `GET /v1/invoices/stats`, client endpoints, templates, settings | no relation joined | n/a |

`clientId` is still returned on the invoice row. It is the invoice owner's
own column, and a random UUID that grants nothing: every lookup by it is
owner-scoped. Returning it keeps the response shape, and keeps the
broken link visible to the owner, who can fix it with
`PATCH /v1/invoices/:id {clientId}` (now working, §1).

### What B does not cover

- **Whole-record takeovers.** Before the fix, a sync change carrying
  `userId` could move a client or invoice into another account. That
  record's `user_id` is now the attacker's, and every read path treats it
  as theirs. Hiding records based on history would mean overriding the
  only ownership column. I left that to operator review: the report lists
  these rows (`owner_field_in_change`, and `applied_change_by_other_user`
  when the victim had sync history on the record).
- Totals: an injected item was hidden, but the invoice's stored `total`
  may still include it. Sync item changes don't recompute totals. Not
  changed.
- If the owner replaces an invoice's items (`PATCH` with `items`), all
  rows, hidden ones included, are deleted, as before. That destroys
  evidence. Run the report first (§4).

### Evidence

`backend/test/historical-cross-owner.e2e-spec.ts` boots the real `AppModule`
through supertest against a real PostgreSQL. It uses real JWTs for two
synthetic users. `PdfService`, `S3Service`, `EmailService` and
`NotificationService` are replaced by recorders, so the test can see
exactly what would have been rendered, mailed or notified. The malformed
rows are inserted directly in `beforeEach`:

- invoice A-0002 of user A → user B's client (name, email, phone, notes as markers);
- item "INJECTED BY A" on B's invoice, with an applied `create` change by A;
- attachment on B's invoice created by A; attachment created by B, then re-pointed by A at A's invoice.

Every test has a legitimate-owner positive control.

| state | result |
|---|---|
| before any fix (`6ae9646`) | **17 failed, 3 passed, 20 total**. Passing: invoice create and CSV import (already checked) and the rejected-push guard |
| after A (`0f957de`) | 12 failed, 8 passed (all of section A passes) |
| after B (`84818d4`) | **20 passed, 20 total** |

Failure output on the old code, quoted from the run:

- list: `Received string: ..."client":{..."userId":"<B>","name":"Victim Client","email":"victim-client@example.test","phone":"+1-555-0100",..."notes":"victim secret note"...`
- search `Victim Client` as A: `Expected length: 0, Received length: 1`
- PDF and send of A-0002: `Expected: 400, Received: 201`
- paid and payment-received notifications: `"clientName":"Victim Client"`
- B's GDPR export items: `+ "INJECTED BY A"`
- CSV export: `got 500` ("invoice.issueDate.toISOString is not a function"). This was a separate bug, fixed in `dc9fef9`, see below.

Two incidental bugs were fixed in `dc9fef9`, because the tests needed those
paths to run:

- `GET /v1/invoices/export/csv` returned 500 for any user with an invoice;
- the overdue notification threw, for the same reason: Postgres `date`
  columns arrive as strings.

## 3. C: the audit queries

They live in `backend/src/integrity/integrity-report.ts` (`INTEGRITY_CHECKS`).
They are SELECT-only and compare ids as `::text`, because `attachments.owner_id`
is varchar under TypeORM `synchronize` but UUID in `migrations/`.

| id | level | finds |
|---|---|---|
| `invoice_foreign_client` | finding | `invoices.user_id <> clients.user_id` via `client_id` |
| `recurring_invoice_foreign_client` | finding | same for `recurring_invoices` (no write path could create these; checked anyway) |
| `applied_change_by_other_user` | finding | applied (`synced = true`) `device_changes` by a user other than the record's current owner (owner of an item/attachment = owner of its invoice/client) |
| `object_changed_by_several_users` | finding | ids with applied changes from more than one user, **including records that no longer exist**, and takeovers where the current owner is the attacker |
| `owner_field_in_change` | finding | any change whose `change_json` has `userId`. Before the fix, this moved or planted records. After deployment such pushes are ignored, so compare `created_at` with the deploy time |
| `relation_repointed_by_sync` | finding | applied updates that rewrote `clientId` / `invoiceId` / `ownerId` / `ownerType`. The old value is not stored. Legitimate re-pointing within one account also appears here |
| `attachment_without_owner` | finding | attachments whose `owner_id` matches nothing of its `owner_type` |
| `rejected_change_by_other_user` | info | rejected attempts on another user's record. No data changed, so it doesn't affect the exit code |
| `applied_delete_without_create` | info | applied deletes of items/attachments that no longer exist and that the actor never created through sync. The owner can't be determined. Legitimate deletes of REST-created rows look the same |

These supersede queries 1–3 in `2026-10-25-sync-ownership.md` §6. Query 2
there didn't distinguish rejected attempts (which the fixed push still logs)
from applied changes.

## 4. Running the report

```sh
cd backend
# from a checkout (ts-node):
INTEGRITY_DATABASE_URL='postgres://invoiceme_audit@db-host:5432/invoiceme' npm run integrity:report
# or with the app's variables: DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_DATABASE
# TLS: INTEGRITY_DB_SSL=true (verifies the server certificate)

# inside the Docker image (compiled; ts-node is a dev dependency):
node dist/integrity/integrity-report.js
```

Note: a local `npm run build` puts the output under `dist/src/...`, because
`migrations/data-source.ts` widens the compile root. `npm run
integrity:report:prod` (and the existing `start:prod`) use the Docker layout,
`dist/...`. I didn't change the build layout.

How it stays read-only:

1. The session is opened with `default_transaction_read_only=on`.
2. All checks run in one transaction that starts with `SET TRANSACTION READ ONLY`.
   `SHOW transaction_read_only` must return `on`, or it aborts before any check.
3. The transaction is always `ROLLBACK`ed.

**Recommended: a dedicated read-only role**, so the guarantee does not rest on
the script. Run this as an administrator, and review it first. I did not run
it anywhere except to reason about it:

```sql
CREATE ROLE invoiceme_audit LOGIN PASSWORD '<secret>';
ALTER ROLE invoiceme_audit SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE invoiceme TO invoiceme_audit;
GRANT USAGE ON SCHEMA public TO invoiceme_audit;
GRANT SELECT ON clients, invoices, invoice_items, attachments, recurring_invoices, device_changes TO invoiceme_audit;
```

Prefer a replica or a snapshot over the primary. The output contains user and
record ids (no names or emails), so treat it as personal data.

Exit codes: `0` no findings, `1` findings (rows printed per check), `2` the
report couldn't run.

Tested in `backend/test/integrity-report.e2e-spec.ts` (4 tests), against the
seeded test DB:

- ids and counts per check: 8 finding rows from 6 seeded cases, plus 1 row for each info check;
- a fingerprint of every table is unchanged after a run;
- an `UPDATE` placed inside the report transaction fails with "read-only transaction" and changes nothing;
- `npm run integrity:report` exits 1 on the seeded DB and 0 after truncation.

## 5. Establishing legitimate ownership

None of this can be decided from one row. Evidence to collect per finding:

1. **`device_changes` history of the record and its relation:** who created
   it (`change_type = 'create'`), who changed what, and when. A record
   created through sync by user X, then changed by user Y, points to X as
   owner.
2. **Which side existed first:** compare `created_at` of the invoice and the
   client. An invoice that is older than the client it points at was
   re-pointed later.
3. **REST audit trail:** `audit_logs` stores the acting `user_id` and IP.
   For invoices it has `create`/`update` rows with the invoice id
   (`invoices.controller.ts`). A REST-created invoice has a `create` entry
   by its real owner. For clients, only CSV imports are logged, as `bulk`
   without ids. Single client create/update writes no audit row. Sync
   changes don't write `audit_logs`.
4. **Account context:**
   - Does the client appear in other invoices of the same user?
   - Do the invoice number series match the user's format?
   - Do the related records share a device id (`device_changes.device_id`)?
5. **Ask the affected users.** This is the only source for records created
   over REST and then moved through sync, which leave no create history.
   Ask both parties, without revealing one user's data to the other.

### Cases that need operator review (all of them, effectively)

- `invoice_foreign_client`. Either the invoice owner pointed at someone
  else's client to read it (attacker = invoice owner, victim = client
  owner), or an attacker planted the invoice into the victim's account with
  the attacker's own client. `owner_field_in_change` and the history tell
  which.
- `applied_change_by_other_user` / `object_changed_by_several_users`.
  These cover tampering, injection, deletion and theft. The actor list and
  the change payloads show what was done.
- `owner_field_in_change`. The record may now be in the wrong account.
- `relation_repointed_by_sync`. These can be legitimate (moving an
  attachment between one's own invoices). The previous value is not
  stored, so look for the victim's `create` row or ask.
- `attachment_without_owner` and `applied_delete_without_create`. The
  owner can't be determined from the database. If a victim's data was
  deleted, only backups can restore it.

## 6. Remediation plan: options, NOT executed

Nothing here has been run. Each option needs an owner's decision, a backup,
and for data changes a reviewed migration or script (with its own read-only
dry run). The read-side guards in §2 keep the data from leaking meanwhile.
None of the options is urgent for confidentiality alone.

| Case | Options |
|---|---|
| Invoice → another user's client | (a) Leave as is. The guards hide the client; the owner sees a 400 on PDF/send and can re-point it to one of their own clients. (b) Re-point to a client the invoice owner owns: create a copy holding only the details the owner had entered, if they can be reconstructed, otherwise ask the owner. (c) If the invoice was planted into a victim's account, soft-delete it (`deleted_at`) or move it back once the owner is established |
| Recurring invoice → another user's client | Deactivate (`is_active = false`) pending review. The cron already fails on these, because `create` rejects the client |
| Injected item on a victim's invoice | Delete the item and recompute the invoice totals, or leave it hidden. Tell the invoice owner if it was ever sent (PDF/email) before this fix |
| Victim's item/attachment moved into another account | Move it back (`invoice_id` / `owner_id`) once the owner is established. It's hidden from the current holder meanwhile only if the victim had sync history on it |
| Record taken over via `userId` | Move it back (`user_id`) after confirming with both users. Review everything the record links to |
| Tampered values (e.g. invoice marked paid, total changed) | Restore from backups or from the owner's records. The sync history shows the new values only |
| Deleted victim records | Restore from backups if the owner wants them |
| Attachment without owner | Leave it (no read path reaches it) or delete it after checking the file in storage |
| Any confirmed abuse | Treat it as a personal-data incident: notify the affected users (and authorities, if required), revoke the attacker's sessions and API keys, and preserve `device_changes` and `audit_logs` as evidence before changing anything |

Once the report is clean, follow-up hardening could be considered (not
done): a composite foreign key or trigger enforcing `invoices.user_id =
clients.user_id`, or adding `user_id` to `invoice_items` and `attachments`.
Both are schema changes and need their own migration review.

## 7. Commands and counts

Environment: disposable PostgreSQL 16 (`initdb` under `/var/tmp/agentd-pg`,
port 55433, trust auth, database `invoiceme_test`, synthetic users only).
The schema was built from entities with `DB_SYNCHRONIZE=true`, as in CI.
Node v22.22.0, `npm ci` with `PUPPETEER_SKIP_DOWNLOAD=true`, and
`NODE_OPTIONS=--max-old-space-size=8192` for jest. Env vars are as in
`.github/workflows/ci.yml`, with host 127.0.0.1 and port 55433.

| check | command (in `backend/`) | base `07ca855` | HEAD |
|---|---|---|---|
| Unit | `npx jest` | 17 suites, **331 passed** | 17 suites, **331 passed** |
| E2E | `npx jest --config ./test/jest-e2e.json --runInBand` | 6 suites, **111 passed** | 8 suites, **135 passed** (historical-cross-owner 20, integrity-report 4) |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | | exit 0 |
| Build | `npm run build` | | exit 0 |

Not checked: the deployed environment and its data, the `.sql` migrations
schema (I tested the `synchronize` schema only), PostgreSQL 15 and Node 20
(the CI versions), the Flutter client's handling of `client: null` on REST
responses (sync pull already returned it), and lint (no config in the repo).
