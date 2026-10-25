# Sync endpoint: missing per-user ownership checks (2026-10-25)

- **Branch:** `security/sync-ownership` (not pushed: this session has no git remote)
- **Scope:** `backend/src/sync/sync.service.ts` (`POST /api/v1/sync/push`, `GET /api/v1/sync/pull`)
- **Status:** fixed on the branch. Not merged, not deployed.

## 1. The problem in plain language

Any logged-in user could read, change or delete another user's invoicing
data through the sync endpoint, given that record's id. It worked like this:

- **Change or delete someone else's records.** Push looked records up by id
  alone, with no check of who owned them. With another user's client,
  invoice, invoice line item or attachment id, an attacker could overwrite
  it (for example mark an invoice paid or change its total) or delete it.
- **Take over someone else's records.** Pushed `data` was copied straight
  onto the record, including `userId`. An attacker could set `userId` to
  their own id and the victim's client or invoice moved into the attacker's
  account. The same field let a user create records inside another account.
- **Plant data in someone else's account.** Invoice items and attachments
  had no ownership check at all. An attacker could add line items to a
  victim's invoice, or attach a file with an attacker-chosen URL to it.
  Both then showed up in the victim's own sync pull.
- **Read someone else's client details.** An attacker could create their own
  invoice that pointed at a victim's client id. Their next pull then returned
  that invoice with the victim's full client record embedded: name, email,
  phone, address and notes.
- Reusing an existing id in a `create` was also treated as an update of that
  record, whoever owned it.

### Where authorization was expected and was not

| Layer | Finding |
|---|---|
| Guard | `JwtAuthGuard` authenticates. `request.user.userId` = JWT `sub`. Nothing checks authorization per record. |
| Controller | Passes `user.userId` to the service. Correct. |
| Service | `change.userId` was the JWT user, but `...change.changeJson` was spread **after** it on create and `Object.assign`ed on update, so `data.userId` won. Updates and deletes used `{ id }` only. Items and attachments had no owner check. |
| DTO validation | The sync DTOs had no class-validator decorators, so nothing inside `data` was validated (and see the next section). |
| DB constraints | Foreign keys check existence, not ownership. `invoices.client_id → clients.id` lets a user reference any client. |
| Entity subscribers / listeners | None in `src/`. |

### How exposed was production?

**Blocked, by accident, in a `src/main.ts` deployment.** The production
bootstrap installs a global `ValidationPipe` with `whitelist`,
`forbidNonWhitelisted` and `forbidUnknownValues`. The sync DTOs had no
class-validator metadata, so that pipe rejects a well-formed push with:

```
REJECTED 400 {"message":["an unknown value was passed to the validate function"],"error":"Bad Request","statusCode":400}
```

I observed this with the exact `main.ts` options, both directly and through
supertest (test "accepts a well-formed push from the mobile client" failing
with `expected 200 "OK", got 400` on the original code). By class-validator
semantics it applies to any body. I tested a well-formed body, not every
possible payload. The Dockerfile starts `dist/main.js`, so a Docker
deployment uses this pipe. I have no access to the deployed environment and
cannot confirm what actually runs there.

Consequences:

- In a `main.ts` deployment, sync push did not work at all, for attackers or
  for the app. The read leak above needs a push first, so it was blocked too.
- The flaws are fully exploitable in any setup that doesn't apply that pipe.
  The existing E2E harness is one: every reproduction below goes through it.
- **Fixing the DTOs (which this branch also does, in its own commit) without
  the ownership fix would have made the vulnerability live.** The two must
  ship together, ownership first.
- The shipped Flutter app never calls `SyncService.queueChange` (only its
  definition exists in `mobile/lib`), so normal app use doesn't push changes.
  Exploiting the flaw needs a hand-crafted HTTP request with any valid JWT.

## 2. What changed

Commits on top of `main` (`cc9912e`):

1. `test(sync): add cross-account ownership regression tests`: tests only.
2. `fix(sync): enforce per-user ownership on pushed changes`
   - All lookups are scoped to the authenticated user: `{ id, userId }` for
     clients and invoices, a join through `invoice.userId` for items, and an
     owner check (invoice or client of the user) for attachments.
   - Related records are validated, not only the primary object:
     `invoice.clientId`, `item.invoiceId` and `attachment.ownerType/ownerId`
     must belong to the same user. This is checked on create and whenever a
     change rewrites them.
   - The owner is always the JWT user. `data` is filtered to real entity
     columns minus `id` and `userId`, so relation objects and `userId` are
     dropped.
   - Creates use `insert()` instead of `save()`. TypeORM's `save()` with an
     explicit id would `UPDATE` an existing row of another user. With
     `insert()` that id now fails on the primary key.
   - Invoice update clears the eagerly loaded `client` relation when
     `clientId` changes, so the new id is what gets saved. A positive-control
     test covers this.
   - Unit spec mocks were updated (`insert`, `exists`, `metadata`). I added
     two unit tests: the owner is never taken from `data`, and a foreign
     delete counts as failed.
3. `fix(sync): add validation decorators to sync push DTOs`: a separate,
   clearly established defect (push returned 400 under the production pipe).
   It declares exactly the fields the mobile client already sends. `data`
   stays a free-form object.
4. `docs: ...`: this report, `docs/SYNC-CONTRACT.md`, and a corrected sync
   section in `docs/API.md`.

Added in review:

5. `test(sync): cover reused ids and relation objects in ownership tests`:
   closes two gaps found by mutation testing (invoice create via `save()`,
   and relation objects such as `data.client` bypassing the column filter).
6. `fix(sync): never embed another user's client in pull`: pull nulls an
   embedded `invoice.client` that is not the user's, so pre-existing
   cross-owner rows no longer leak the client record.

### How rejections are reported

The existing response is `{ synced, failed }` with no per-change detail.
Unauthorized changes are **not applied** and are **counted in `failed`**,
the same as any other change that cannot be applied. The response doesn't
say why; the reason is logged server-side. It does still reveal whether a
foreign id exists (see section 6, item 2). Deleting an id that does not exist anywhere remains a
no-op success, as before, so retries stay idempotent. Deleting another
user's id fails. The response shape is unchanged.

**Batches:** each change is independent, which is the existing contract
(there is an existing "Partial Success" E2E test). In a mixed batch the
authorized changes are applied and the unauthorized ones are not. The batch
test checks both the counts and the DB state. A rejected change still leaves
its own `device_changes` audit row (`synced = false`, owned by the actor).
That row doesn't touch the victim's data.

Timestamps and conflict resolution were deliberately not touched. See
`docs/SYNC-CONTRACT.md`.

## 3. Regression evidence

Environment: disposable PostgreSQL 16 cluster (`initdb` in
`/var/tmp/invoiceme-pgtest`, port 55432, database `invoiceme_test`), with
only synthetic users. The schema came from TypeORM `synchronize` via
`DB_SYNCHRONIZE=true`, the same as CI. Node v22.22.0, npm 10.9.4.

Test file: `backend/test/sync-ownership.e2e-spec.ts`. It boots the real
`AppModule` through supertest, uses two users with real JWTs, and has a
positive control for each denial.

**Before (original `sync.service.ts`, final test file):**

```
      ✕ rejects updating another user’s client; owner update succeeds
      ✕ rejects a CREATE that reuses another user’s client id
      ✕ rejects soft-deleting another user’s client; owner delete succeeds
      ✕ ignores a client-supplied userId on create (owner is always the authenticated user)
      ✕ ignores a client-supplied userId on update (no ownership transfer)
      ✕ rejects updating another user’s invoice; owner update succeeds
      ✕ rejects soft-deleting another user’s invoice; owner delete succeeds
      ✕ rejects creating an invoice that references another user’s client, and pull does not leak it
      ✕ rejects re-pointing an own invoice at another user’s client
      ✕ rejects an invoice update that sets userId to another user
      ✕ rejects adding an item to another user’s invoice; owner add succeeds
      ✕ rejects updating another user’s item; owner update succeeds
      ✕ rejects moving an item onto, or stealing it into, another user’s invoice
      ✕ rejects deleting another user’s item; owner delete succeeds and is idempotent
      ✕ rejects attaching a file to another user’s invoice; owner attach succeeds
      ✕ rejects updating or deleting another user’s attachment; owner delete succeeds
      ✕ rejects re-pointing an own attachment at another user’s client
      ✕ applies the authorized changes in a batch and none of the unauthorized ones
      ✓ returns only the authenticated user’s records across all collections
      ✕ accepts a well-formed push from the mobile client
      ✕ still enforces ownership
      ✓ rejects a malformed change list with 400
Tests:       20 failed, 2 passed, 22 total
```

The two passing tests are guards, not reproductions. Pull isolation of
untampered data was already correct, and the original code returns 400 for
everything under the production pipe. The same 20/2 result was recorded on
the tests-only commit before the extra positive control was added.

The failing assertions stop at the response counts, so a throwaway probe
(not committed) recorded what the original code actually wrote, with A as
attacker and B as victim:

```
PROBE A updates B client: response => {"synced":1,"failed":0}
PROBE B client after => {"name":"pwned","email":"attacker@evil.test","ownerIsB":true}
PROBE A sets userId=A on B client: owner now A? => true
PROBE A updates B invoice => {"response":{"synced":1,"failed":0},"total":"1.00","status":"paid"}
PROBE A deletes B item => {"response":{"synced":1,"failed":0},"stillExists":false}
PROBE A injects item into B invoice; visible in B pull => true
PROBE A injects attachment on B invoice; visible in B pull => true
PROBE A soft-deletes B invoice; deletedAt set => true
PROBE A deletes B attachment; still exists => false
PROBE Production pipe: well-formed push => {"status":400,"body":{"message":["an unknown value was passed to the validate function"],"error":"Bad Request","statusCode":400}}
```

Cross-account read (separate clean run): A pushes an invoice with
`clientId` = B's client, then pulls:

```
PROBE2 {"push":{"synced":1,"failed":0},"embeddedClient":{"id":"c09c9a0f-…","userId":"f2c34c1a-…" (B),"name":"Victim Client","email":"victim-client@example.test",…}}
```

**After the ownership fix only (before the DTO commit):** 20 passed, 2
failed. The two failures were the production-pipe tests, still getting 400.

**After all commits:**

```
Tests:       22 passed, 22 total
```

## 4. Final verification (HEAD of the branch)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **17 suites, 331 passed** (main: 17 suites, 329 passed) |
| E2E tests | `npm run test:e2e` | **6 suites, 107 passed** (main: 5 suites, 85 passed) |
| Type check | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| Build | `npm run build` | exit 0 |
| Lint | `npm run lint` / `npx eslint ...` | **could not run:** "ESLint couldn't find a configuration file". There's no ESLint config tracked anywhere in the repo, so this is pre-existing. CI does not run lint. |

I verified the main baseline myself in this session: 329 unit / 85 E2E.

Environment note: in this container, both suites crash with
`JavaScript heap out of memory` on Node 22's default heap. All runs above
used `NODE_OPTIONS=--max-old-space-size=8192`. CI uses Node 20 and wasn't
changed.

## 5. What was mocked or not exercised

- **Not exercised:** the Flutter client (no Flutter SDK here) and the real
  `main.ts` bootstrap. The production `ValidationPipe` options were copied
  into the test, but helmet, CORS, rate limiting and compression weren't run.
- **Not exercised:** the SQL migrations in `backend/migrations/`. The test
  schema comes from TypeORM `synchronize`, the same as CI. Some column types
  differ: for example `device_changes.object_id` and `attachments.owner_id`
  are `varchar` in the test schema but `UUID` in migration 007/005. The
  audit queries below cast to text so they run on both.
- PostgreSQL 16 was used locally. CI uses `postgres:15`.
- The unit tests (`test/sync.service.spec.ts`) mock the repositories. The
  E2E tests use a real database and the real Nest app.
- No real user data was touched. The only database used was the disposable
  local cluster.

## 6. Remaining issues and follow-ups

Security-adjacent:

1. **Check existing data for past abuse** before or right after deploying.
   The queries below only read. I checked them against the disposable DB
   after replaying attacks on the original code: they flagged the injected
   item, the attachment swap, the invoice tamper, the cross-owner
   invoice→client link and the `userId` takeover.
   Limitation: a victim's hard-deleted items and attachments leave no row
   to join against. Review `device_changes` rows of type `delete` whose
   `object_id` has no surviving record manually.

   ```sql
   -- 1. Invoices whose client belongs to a different user
   SELECT 'invoice_foreign_client' AS finding, i.id AS object_id, i.user_id AS invoice_owner, c.user_id AS client_owner
   FROM invoices i JOIN clients c ON c.id = i.client_id
   WHERE i.user_id <> c.user_id;

   -- 2. Sync changes made by one user to a record owned by another user
   SELECT 'cross_user_change' AS finding, dc.object_type::text, dc.object_id::text, dc.change_type::text, dc.user_id::text AS actor, dc.created_at
   FROM device_changes dc
   LEFT JOIN clients c        ON dc.object_type::text = 'client'       AND c.id::text = dc.object_id::text
   LEFT JOIN invoices i       ON dc.object_type::text = 'invoice'      AND i.id::text = dc.object_id::text
   LEFT JOIN invoice_items ii ON dc.object_type::text = 'invoice_item' AND ii.id::text = dc.object_id::text
   LEFT JOIN invoices ii_inv  ON ii_inv.id = ii.invoice_id
   LEFT JOIN attachments a    ON dc.object_type::text = 'attachment'   AND a.id::text = dc.object_id::text
   LEFT JOIN invoices a_inv   ON a.owner_type::text = 'invoice' AND a_inv.id::text = a.owner_id::text
   LEFT JOIN clients a_cli    ON a.owner_type::text = 'client'  AND a_cli.id::text = a.owner_id::text
   WHERE dc.user_id::text <> COALESCE(c.user_id, i.user_id, ii_inv.user_id, a_inv.user_id, a_cli.user_id, dc.user_id)::text;

   -- 3. Sync changes that carried a userId (the owner field). Any row here is suspicious:
   --    an attacker would set it to their own id to take over a record, which query 2 cannot see.
   SELECT 'owner_field_in_change' AS finding, dc.object_type::text, dc.object_id::text, dc.user_id::text AS actor, dc.change_json->>'userId' AS requested_owner, dc.created_at
   FROM device_changes dc
   WHERE dc.change_json ? 'userId';
   ```

   If the production pipe has always been in place, these should return
   nothing, because push could not succeed there.
2. **Id existence oracle (minor):** a create or delete that uses a foreign
   id fails, while one with a fresh id succeeds (delete is a no-op success). Ids are random UUIDs, so this isn't
   practical to exploit. Documented, not changed.
3. **Pre-existing cross-owner invoice→client links (query 1).** Pull no
   longer embeds a client the user does not own (fixed in review), but the
   REST invoice endpoints, PDF generation and GDPR export still load
   `invoice.client` and would show it. Clean up those rows.
   **Update:** handled in `2026-10-25-historical-cross-owner.md`. Every read
   path now fails closed, and `npm run integrity:report` replaces the
   queries above with a read-only report. No rows were cleaned up.
4. The attachment `url` is free text from the device, the same as before.
   No URL validation was added.

Sync defects that need product decisions, listed in `docs/SYNC-CONTRACT.md`
and not changed here: no conflict handling (arrival order wins, `updated_at`
ignored); a counts-only push result combined with the client's
`take(synced)` marking the wrong changes as synced; deletions not
propagating through pull; incremental pull missing item- and
attachment-only changes; the `lastSyncTimestamp` window; no batch size
limit. The README sentence claiming last-write-wins by timestamp is
inaccurate and has not been edited.

## 7. Proposed merge / deploy steps and recovery

1. Apply the branch from the reviewed mbox
   (`drafts/review/sync-ownership-reviewed.mbox`) onto `main` with
   `git am`. Then push and open a **draft** PR. CI must be green (unit,
   migrations, E2E, build, Docker build).
2. Review commits 2 and 3 together. **Do not ship commit 3 (DTO
   validation) without commit 2.** Commit 3 makes push reachable under the
   production pipe.
3. Run the audit queries (section 6.1) read-only against production.
   Investigate any hits before deploying, and keep the results.
4. Deploy the backend. No migration and no schema change. The response
   shape is unchanged, so no mobile release is needed.
5. Smoke-test after deploy, with two test accounts: a push that creates a
   client returns `{synced:1, failed:0}`, and the same push from user A
   against B's client id returns `{synced:0, failed:1}` and leaves B's
   record unchanged.
6. **Recovery / rollback:** redeploy the previous image. There's no data
   migration to undo. Rolling back to the previous image restores the old
   push-400 behaviour in a `main.ts` deployment, which is safe but not
   functional. **Do not roll back to a build containing commit 3 without
   commit 2.** If abuse is found, restore the affected rows from backups,
   using the `device_changes` rows (actor, `change_json`, `created_at`) as
   the audit trail.
