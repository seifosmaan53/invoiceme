# Follow-up review: `security/sync-ownership`, `07ca855..70525cf`

Reviewer: independent follow-up review, 2026-10-25. Scope: the 9 commits
`b031143..70525cf`, which cover historical cross-owner read/write guards,
the integrity report, the container Chromium fix and the PDF smoke test.
The earlier sync work was not re-audited. The agents' docs were used as a
map only. Every claim below comes from code read or a command run here.

**Verdict: no concrete security blocker.** I found one confirmed Low issue:
a delete pushed through sync by one user could hide another user's own
records. It is fixed in `efeab78`, with a regression test. I also found one
test gap in the integrity report's read-only guards. It is closed in
`5a3d426`. The rest are informational or residual risks the agents already
documented.

## Findings

| id | severity | file:line | evidence | status |
|---|---|---|---|---|
| F1 | Low | `backend/src/core/utils/cross-owner.util.ts:163-171` (before fix); `backend/src/sync/sync.service.ts:351-357,380-382` | `idsChangedByOtherUser()` counted every applied change by another user, **deletes included**. Sync applies a delete of an id that exists nowhere as a no-op and marks it `synced = true`. User A can therefore log a delete for an id. If user B later creates a record with that id (for example, a device re-pushing an item), the record is hidden from B everywhere: detail, PDF, GDPR export, the attachment list and sync pull. New test, run without the fix: `Expected value: "…0a01"  Received array: ["f36ad9d1-…"]`, so B's own re-created item was missing. To exploit this on demand, A has to know or predict B's client-generated UUID. A delete never plants a record, so not counting deletes is safe. **Fixed in `efeab78`.** | CONFIRMED (mechanism); exploitability needs a known id |
| F2 | Low (test gap) | `backend/src/integrity/integrity-report.ts:390-394,440` | Mutation M5b (drop `default_transaction_read_only=on` from `connectionConfig`) and M5c (drop the `SHOW transaction_read_only` assertion) both left all 24 tests green. Exit code 2 and the claim that errors print no secrets were also untested. **Tests added in `5a3d426`.** They kill M5b and M5c, and they check that exit code 2 output does not contain the password. | CONFIRMED |
| F3 | Info | `backend/src/invoices/invoices.controller.ts:321-326` | M9 (remove the new `send` refusal) survives. The pre-existing `!invoice.client?.email` check still returns 400, because `findOne()` already nulls a foreign client. So the refusal is redundant defence in depth, and the protection itself is covered by the test, which checks for no email and no victim data. | CONFIRMED, no change needed |
| F4 | Info | `backend/src/integrity/integrity-report.ts:404` | M8 (`ROLLBACK` → `COMMIT`) survives. This is harmless: the transaction is `READ ONLY`, so the "writes nothing" and write-probe tests still hold. | CONFIRMED, no change needed |
| F5 | Info (residual, documented) | `docs/security/2026-10-25-historical-cross-owner.md:73-79,108-120` | Some legacy damage is not hidden on read: whole-record takeovers through legacy `userId`; a victim's REST-created item or attachment that the old push moved into an attacker's invoice (no victim sync history, so it stays visible to the attacker, attachment URL included); stored totals that still include hidden injected items. The report flags these through `owner_field_in_change`, `relation_repointed_by_sync` and `object_changed_by_several_users`, and they need operator review. | PLAUSIBLE (accepted residual) |
| F6 | Info | `backend/package.json:31`, `backend/Dockerfile:24-28` | `integrity:report:prod` runs `dist/integrity/integrity-report.js`. That path exists only in the Docker layout, where the builder copies `src/` alone. A host `npm run build` emits `dist/src/...`, because `migrations/` is in the tsconfig scope, so the `:prod` script fails outside the image. This is operational, not a security issue. | CONFIRMED (host build) |
| F7 | Info | `backend/Dockerfile:62-64` | `PUPPETEER_SKIP_DOWNLOAD=true` is also set in the runtime stage. That stage runs no `npm install`, so it has no effect. It is harmless, but it is not "build stages only". | CONFIRMED |
| F8 | Info | `backend/test/container/pdf-smoke.sh:33` | `timeout … docker run` kills the docker CLI on a stall. With no `--init`, Node runs as PID 1 and may ignore SIGTERM, so the container can outlive the step. The step still fails, which is correct, and the CI job also has a `timeout-minutes: 10`. | PLAUSIBLE |

## Item-by-item

1. **Read paths.** I grepped every `relations:`, join, `.client` and `.items`
   use and every Invoice/Attachment/Payment repository. Invoice `client` is
   **eager**, so every Invoice `find*` loads it. Each consumer is covered:
   - list and search: the join is restricted to the owner's client.
   - detail, PDF, send, duplicate, convert and `/pay`: they go through `findOne()`, which nulls a foreign client and filters items.
   - update, archive and delete: they use `findOwned()` only for the write, then return `findOne()`.
   - CSV export: `withoutForeignClient`.
   - GDPR export: the relation is not loaded and items are filtered.
   - attachments and sync pull: filtered.
   - paid, overdue and payment-received notifications: `ownedClient()`.
   - dashboard stats: no join.
   - recurring cron: goes through `InvoicesService.create`, which rejects a foreign client.
   - templates: no relation.

   I found no endpoint that still returns or renders another user's client.
   The "hidden if another user applied a sync change" rule is sound against
   rejected pushes (M6 is caught). It had the delete hole described in F1,
   which is now fixed.
2. **Write paths.** Client create, update and CSV import, invoice
   create/update (items built field by field), template create/update
   (allow-list), duplicate and convert (`assertClientOwned`), and payments
   (`invoiceId` comes from `findOne`) set no foreign key without an owner
   check. None of them copy `id` or `userId` from a body. No issues found.
3. **Tests.** Both specs pass on an isolated PostgreSQL 16 (port 55432, trust
   auth, `DB_SYNCHRONIZE=true`): 24/24 before my changes, 28/28 after. Jest
   needed `NODE_OPTIONS=--max-old-space-size=6144`, because the default heap
   ran out of memory during ts-jest compile.
4. **Integrity report.** It is read-only in three ways: the session defaults
   to read-only, it runs `SET TRANSACTION READ ONLY` and verifies it with
   `SHOW`, and it always rolls back. All three are now tested. Output
   contains only ids, owner ids, timestamps and `change_json->>'userId'`, and
   errors print only `error.message`. Exit codes are 0, 1 and 2, all now
   tested.
5. **Container.**
   - The runtime user is `nodejs`, uid 1001. The smoke test checks both `Config.User` and `process.getuid()`.
   - `PUPPETEER_EXECUTABLE_PATH` is used by `PdfService.getChromeExecutablePath()` and by `PdfCacheService.getBrowser()`. On Linux, `PdfService` has no fallback once a path is set, so the smoke test cannot pass on a different browser.
   - The smoke script calls the real compiled `PdfService` and `PdfCacheService`. It validates `%PDF-`, `%%EOF`, `pdfinfo` page count, optionally `qpdf --check`, and that `pdftotext` contains the invoice number. It fails on a stall or timeout.
   - I ran `pdf-smoke.js` on the host against `dist/src` with the pre-installed Chromium. It produced valid PDFs (149,946 and 15,040 bytes, 2 pages, `Invoice #HOST-SMOKE-1` extracted), and both launch paths reported the configured executable.

## Mutation results (historical-cross-owner + integrity-report E2E, one at a time)

| mutation | caught by |
|---|---|
| M1 remove PDF foreign-client refusal | PDF generation refuses … (1 test) |
| M2b skip GDPR item filter | GDPR export contains no … injected (1) |
| M3 drop `client.userId = invoice.userId` from the list join | invoice list omits …; invoice search cannot match … (2) |
| M4 template allow-list → `Object.assign` | a template update cannot change its owner … (1) |
| M5a drop `SET TRANSACTION READ ONLY` | 3 integrity tests |
| M5b drop session `default_transaction_read_only` | **survived** → caught after `5a3d426` |
| M5c drop the read-only `SHOW` assertion | **survived** → caught after `5a3d426` |
| M6 drop `synced = true` | a rejected (unsynced) foreign change does not hide … (1) |
| M7 skip item filter in `findOne()` | invoice detail and PDF … omit line items … (1) |
| M8 `ROLLBACK` → `COMMIT` | survived (harmless, F4) |
| M9 remove the `send` foreign-client refusal | survived (redundant check, F3) |
| M10 client update stops stripping `id`/`userId`/`user` | a client update cannot change its owner … (1) |

(M2, my first GDPR mutation, did not compile and was discarded. M2b
replaces it.)

## Not checked

- Docker image build and the real in-container smoke test: these were out of
  budget by instruction, and GitHub CI runs them. Two consequences:
  - It is unverified that Alpine's `/usr/bin/chromium-browser` exists in the current `node:20-alpine` base.
  - It is unverified that this Alpine Chromium works with puppeteer 21.11.
- Stripe webhook signature handling and other code outside this diff.
- Performance of the per-invoice `device_changes` query in the GDPR export
  (N queries). It is functionally correct.
- `docs/security/2026-10-25-historical-cross-owner.md` does not yet mention
  that deletes are excluded (F1).
