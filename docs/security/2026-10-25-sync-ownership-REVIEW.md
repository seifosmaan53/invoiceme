# Independent review: `security/sync-ownership`

- Reviewed: `main` (`cc9912e`) .. `e9f89d3` (4 author commits); review fixes added on top (3 commits).
- Date: 2026-10-25. Reviewer did not write the original change. The author's report was used only as a map.
- Line numbers refer to the branch HEAD after the review commits unless stated.

## Verdict

**Ready for owner review**, with the review commits included. The push path's ownership enforcement holds:

- every entity, every change type, and both create and update foreign keys;
- it is exercised through the real Nest app, the real `JwtAuthGuard`/`JwtStrategy` and a real Postgres;
- the HTTP tests fail on the original code and catch 20 of 23 single-check mutants.

The two surviving non-equivalent mutants are now covered. One residual pull leak (pre-existing cross-owner rows) was confirmed and fixed. Nothing blocking remains inside the brief. The follow-ups below are outside it.

## Setup note

The checkout did **not** contain a `security/sync-ownership` ref (`git branch -a` showed only `main`, and there was no remote). The four commits existed as unreachable objects (`git fsck` → `unreachable commit e9f89d3…`, parent chain `e9f89d3 → 964c024 → 9829872 → 008c2ff → cc9912e`). I recreated the local ref with `git branch security/sync-ownership e9f89d3`. Nothing else was altered.

## Findings

| id | severity | file:line | evidence | status |
|---|---|---|---|---|
| R1 | Medium (data exposure; precondition: legacy rows) | `backend/src/sync/sync.service.ts:167` (`relations: ['client']` in `pullChanges`; was line ~165 at `e9f89d3`) | Pull embedded `invoice.client` with no owner check. An invoice of A pointing at B's client is the state the old push allowed and the audit query 1 hunts for. For such an invoice, `GET /api/v1/sync/pull` as A returned B's full client record. New test on `e9f89d3` code: `Received: {"email":"victim-client@example.test", "name":"Victim Client", "userId":"<B>" …}`. The author listed this as follow-up 6.3 but did not fix it. **Fixed** in `ced75be`: `sync.service.ts:171-178` nulls a foreign embedded client. Test: "does not embed another user's client in a pre-existing cross-owner invoice" fails before, passes after, and keeps a positive control that A's own client is still embedded. | CONFIRMED, fixed |
| R2 | Medium (test gap; would hide a regression to full takeover) | `sync.service.ts:332` (`invoiceRepository.insert`) | Mutant M10 (`insert` → `save`) survived all 37 sync E2E tests and 9 unit tests. With `save()`, a CREATE that reuses B's invoice id updates B's invoice and sets `userId` to A. No test covered CREATE-reuse for invoices or items. **Fixed** in `794f386`: tests "rejects a CREATE that reuses another user's invoice id" and "…invoice item id" assert counts and DB state. M10 is now killed. | CONFIRMED, fixed (tests) |
| R3 | Medium (test gap; would hide a FK-reference bypass) | `sync.service.ts:236` (`columns.has(key)` filter) | Mutant M05 (drop the column filter, keep only `id`/`userId` protection) survived everything. Under M05, `data.client = {id: clientB}` on an invoice update re-pointed A's invoice at B's client, bypassing `assertOwnedClient` (observed: `invoice.clientId` became B's client id). TypeORM column metadata (probed on the real DataSource) contains no relation properties, so the shipped code is correct, just untested. **Fixed** in `794f386`: test "ignores relation objects that would re-point foreign keys" covers invoice→client, item→invoice and client→user, with positive controls. M05 is now killed. | CONFIRMED, fixed (tests) |
| R4 | Low / info (existence oracle; doc and comment inaccuracy) | `sync.service.ts:16-22`; `docs/security/2026-10-25-sync-ownership.md` §2 "How rejections are reported" | The code comment and report claimed rejections don't reveal whether a foreign id exists. They do: DELETE of a foreign id → `{synced:0, failed:1}`, DELETE of an unknown id → `{synced:1, failed:0}`. The existing E2E tests pin both ("rejects deleting another user's item…" and its idempotent retry). CREATE is the same. Ids are UUIDv4, so impact is minimal. **Fixed (docs/comment)** in `8ecbf0a`. Behaviour unchanged, since changing it is a product decision. | CONFIRMED, docs fixed |
| R5 | Info (report accuracy) | `docs/security/2026-10-25-sync-ownership.md` §2, §7 | The report lists an empty `chore: session push probe` commit and tells the merger to `git am docs/security/sync-ownership.mbox` and `--allow-empty`. Neither the commit nor the file exists on the branch, so the commit numbers in the "do not ship commit 4 without commit 3" warnings were off by one. **Fixed** in `8ecbf0a`. | CONFIRMED, fixed |
| R6 | Info (test naming) | `backend/test/sync-ownership.e2e-spec.ts:328` | Test "rejects an invoice update that sets userId to another user" asserts `failed: 0`. The field is ignored, not rejected. The assertions are correct (owner unchanged, victim pull doesn't contain it). Only the name is misleading. Not changed. | CONFIRMED, not fixed |
| R7 | Low (reporting consistency, edge case) | `sync.service.ts:128-138` | A change is applied in `processChange`, then `device_changes.synced = true` is saved in a separate statement. If that second save fails, the change is applied but counted in `failed`. There is no transaction around the pair. Not reproduced: it needs a DB failure between two statements. | PLAUSIBLE, not fixed |
| R8 | Info (equivalent mutant) | `sync.service.ts:269` | Mutant M23 (remove "unsupported attachment owner type" throw) survived. It is effectively equivalent, because `attachments.owner_type` is a Postgres enum and an unknown type fails on insert/save anyway. | CONFIRMED equivalent, not fixed |

### Checked and found correct (no finding)

- **Identity.** `SyncController` passes `user.userId`. `JwtStrategy.validate` returns `{ userId: payload.sub }`. No body or query `userId` is read anywhere in sync.
- **Owner on create.** Clients and invoices insert `{ ...data, id, userId }` with `userId` last. `PROTECTED_FIELDS` strips `id`/`userId` from `data`.
- **Lookups.** Clients and invoices use `{id, userId}`. Items use an inner join on `invoice.userId`. Attachments check the existing owner via `assertOwnedAttachmentOwner`.
- **Foreign keys on create and update.** `invoice.clientId`, `item.invoiceId` and `attachment.ownerType/ownerId` are all checked whenever the key is present in `data`, and always on create. Missing or null keys fail.
- **Delete of a foreign record** fails (`assertNotOwnedByOther`) for clients, invoices and items. Attachments fail through the existing-owner check.
- **Pull.** Clients and invoices are filtered by `userId`. Items come only from the user's invoice ids, and attachments only from the user's invoice/client ids. Embedded client is fixed by R1.
- **Batch.** Each change is independent (existing contract). Every create/update/delete is a single statement, so a change has no partial write. In a mixed batch, the batch test asserts both the counts `{synced:2, failed:2}` and the DB state of all four records. A rejected change leaves only the actor's own `device_changes` row (`synced=false`). Nothing reads unsynced rows back: `grep DeviceChange src` shows only sync and the entity list, so there is no replay.
- **Mobile.** `Invoice.fromJson` accepts `client: null` (`mobile/lib/models/invoice.dart:111`), so R1's fix is wire-compatible.

## Test quality (focus 3)

- **Real stack.** `sync-ownership.e2e-spec.ts` builds `AppModule` with only the TypeORM connection overridden, applies `ValidationPipe`, and drives HTTP through supertest. It uses the real `JwtAuthGuard` and `JwtStrategy`, with tokens signed by the app's `JwtService` and `JWT_SECRET`, against a real Postgres. A second app instance uses the `main.ts` pipe options, copied and checked against `src/main.ts:167-179`.
- **Assertions.** Every denial asserts the response counts **and** the DB row afterwards. Every denial has an owner positive control except "rejects re-pointing an own attachment…" and "rejects a CREATE that reuses another user's client id". In both, the positive path is covered by other tests: the owner attach test and the "accepts a well-formed push" test.

### Mutation results

Mutation testing (one check removed or weakened at a time) used the sync E2E suites (`sync-ownership` + `sync`, 37 tests) and the `sync.service.spec.ts` unit suite (9 tests). The results below are from the clean rerun on a fresh cluster. In the first run, Postgres died at M03 because scratchpad permissions changed, and those results were discarded.

| mutant | change | killed by (E2E) | unit |
|---|---|---|---|
| M01 | client lookup `{id}` only | 5: client update/create-reuse/delete, batch, prod-pipe ownership | 1 |
| M02 | client create `save()` | 4: client update, create-reuse, batch, prod-pipe | 2 |
| M03 | client foreign delete → no-op | 1: client delete | 1 |
| M04 | `userId` not protected | 2: client/invoice `userId` on update | 0 |
| M05 | no column filter | **survived** → killed after `794f386` | 0 |
| M06 | invoice lookup `{id}` only | 3 | 0 |
| M07 | invoice foreign delete → no-op | 2 | 0 |
| M08 | invoice `clientId` checked on create only | 1 | 0 |
| M09 | invoice `clientId` never checked | 2 | 0 |
| M10 | invoice create `save()` | **survived** → killed after `794f386` | 0 |
| M11 | eager `client` not cleared | 1 (positive control) | 0 |
| M12 | item lookup without owner join | 3 | 0 |
| M13 | item foreign delete → no-op | 1 | 0 |
| M14 | item `invoiceId` checked on create only | 1 | 0 |
| M15 | item `invoiceId` never checked | 2 | 0 |
| M16 | attachment existing-owner check removed | 1 | 0 |
| M17 | attachment new owner on create only | 1 | 0 |
| M18 | attachment new owner never checked | 2 | 0 |
| M19 | `assertOwnedClient` ignores `userId` | 3 | 0 |
| M20 | `assertOwnedInvoice` ignores `userId` | 4 | 0 |
| M21 | pull clients not user-scoped | 4 (incl. pre-existing `sync.e2e`) | 0 |
| M22 | pull invoices not user-scoped | 3 | 0 |
| M23 | unsupported attachment owner type allowed | survived (equivalent, R8) | 0 |

The unit suite catches only M01–M03. The E2E suite is the real safety net.

## Fail-before / pass-after (focus 4)

- **Tests-only commit `008c2ff`.** It checks out the original `sync.service.ts`. `sync-ownership.e2e-spec.ts` → **20 failed, 2 passed, 22 total**. The 2 passes are "returns only the authenticated user's records" and "rejects a malformed change list with 400", which are guards, not reproductions.
- **Final test file from `e9f89d3` applied onto `main`:** **20 failed, 2 passed, 22 total**, the same two passes. I read the failure messages: they are real assertion mismatches (`{synced:1,failed:0}` vs expected, or `userId` changed to the attacker), plus `expected 200, got 400` for the prod-pipe tests. They are not setup errors.
- **R1 test on the pre-review branch code:** 1 failed (B's client returned). After `ced75be`, it passes.

## Commands and counts

The environment was an isolated PostgreSQL 16 cluster (`initdb` under `/var/tmp/review-pg`, port 55432, trust auth, database `invoiceme_test`, only synthetic users), with the schema built from entities via `DB_SYNCHRONIZE=true` as in CI. Node v22.22.0, and `npm ci` with `PUPPETEER_SKIP_DOWNLOAD=true`. Node 22's default heap OOMs in ts-jest here (observed: `FATAL ERROR: Reached heap limit`), so all jest runs used `NODE_OPTIONS=--max-old-space-size=8192`. The env vars match `.github/workflows/ci.yml`, with host 127.0.0.1 and port 55432.

| check | command (in `backend/`) | HEAD (`8ecbf0a`) | `main` (`cc9912e`) |
|---|---|---|---|
| Unit | `npx jest` | 17 suites, **331 passed** | 17 suites, 329 passed |
| E2E | `npx jest --config ./test/jest-e2e.json --runInBand` | 6 suites, **111 passed** (sync-ownership: 26) | 5 suites, 85 passed |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | exit 0, 0 errors | exit 0 |
| Lint | `npx eslint "src/**/*.ts" "test/**/*.ts"` (not `npm run lint`, which has `--fix`) | **could not run**: "ESLint couldn't find a configuration file" (exit 2) | same, pre-existing |
| Format (substitute) | `npx prettier --check` on the 3 changed TS files | fails | `main`'s `sync.service.ts` fails too; no Prettier config in repo, so not meaningful |
| Build | `npm run build` | exit 0 | exit 0 |

## Follow-ups outside the brief (not fixed)

1. **Legacy cross-owner invoice→client rows still leak outside sync.** These paths load `invoice.client` without checking the client's owner:
   - `InvoicesService.findOne` (`backend/src/invoices/invoices.service.ts:166,184`), so `GET /v1/invoices/:id` and PDF generation are affected;
   - the list at `invoices.service.ts:594`;
   - GDPR export (`backend/src/core/services/gdpr.service.ts:51`).

   Run audit query 1 from the author's report and clean those rows. Alternatively, apply the same defensive filter there.
2. **Fetch-then-compare ownership.** `ClientsService.findOne` (`clients.service.ts:94-105`), `InvoicesService.findOne` (`invoices.service.ts:163-176`) and `InvoiceTemplatesService.findOne` (`invoice-templates.service.ts:21-32`) load by `id` alone, then return 403 for a foreign record vs 404 for a missing one. Ownership is enforced, but this is an existence oracle. Scoping the query by `userId` and returning 404 would close it.
3. Payments look up by `providerPaymentId` only (`payments.service.ts`). That is reached from webhooks, not user ids, and was not reviewed further.
4. Attachment `url` from sync is free text (author's follow-up 6.4). It is not used server-side for fetching (the REST upload stores a signed URL), so there is no server-side IDOR, but there is no URL validation.

## What I could not check

- The deployed environment and which bootstrap it actually runs. The `main.ts` pipe was replicated in tests, but helmet, CORS, rate limits and compression were not run.
- The SQL migrations in `backend/migrations/`. The schema came from TypeORM `synchronize`, the same as CI. Column types differ, for example `attachments.owner_id` is varchar here and UUID in the migration.
- Postgres 15 (CI) vs 16 (local), and Node 20 (CI) vs 22 (local).
- The Flutter client at runtime (no SDK). Only `Invoice.fromJson` was read.
- Lint, which has no config in the repo.
- Concurrency and races (two devices pushing at once), which were not exercised.
