# Payment authorization and attachment URLs (2026-10-25)

- **Branch:** `fix/payments-authz` on `main` `cac08e1` (not pushed: no remote in this session)
- **Scope:** `backend/src/payments/**`, `core/services/stripe.service.ts`, payment parts of
  `backend/src/invoices/**`, attachment URL handling (`backend/src/common/attachment-url.ts`)
- **Builds on:** `2026-10-25-sync-ownership*.md` and `2026-10-25-historical-cross-owner.md`. Not repeated here.
- **Status:** code and tests on the branch. Not merged, not deployed. No data was modified anywhere.
  All evidence comes from a disposable local database with synthetic users. Stripe, S3 and email were mocked.

## 0. Summary

| # | Finding | Class | Fixed |
|---|---|---|---|
| P1 | Every signed Stripe webhook is rejected (400 "Missing request body") under the `main.ts` bootstrap, so payments never complete automatically | proven flaw (functional; fails closed) | yes |
| P2 | `POST /v1/invoices/:id/pay` has no API-key permission: a key scoped to `read:invoices` can create payment intents | proven flaw (authorization scope) | yes |
| P3 | A `payment_intent.succeeded` marks the invoice paid regardless of amount or currency | proven flaw (payment integrity) | yes |
| P4 | Late `payment_failed` downgrades a completed payment. Redelivery re-notifies the owner | proven flaw (integrity, low) | yes |
| P5 | Any processing error (including an unknown payment intent) is answered 400 "signature verification failed" | proven flaw (operability: Stripe retries, then disables the endpoint) | yes |
| A1 | Sync push stores `javascript:`, `data:`, `file:`, `intent:`, ... attachment URLs. REST and sync return them to the app, which opens them with `url_launcher` / `Image.network` | proven flaw (unsafe navigation / unsupported input) | write path and REST read: yes. Sync pull: **proposed, not integrated** (§3.4) |

There are no public payment routes. The README's "Stripe payment links embedded in the PDF" is
not implemented in code: there is no checkout or payment-link code and no route without
authentication other than the webhook.

## 1. Access model (from code and callers)

- **`POST /v1/invoices/:id/pay`** (`ApiKeyOrJwtGuard`, `PermissionGuard`). The only caller is the
  owner's Flutter app (`mobile/lib/screens/payment_screen.dart`). It opens Stripe's payment sheet
  **on the owner's device** with the returned `clientSecret`, then also `PATCH`es the invoice to
  `paid`. Nobody else ever sees the `clientSecret`.
- **`POST /v1/webhooks/stripe`**: unauthenticated by design. Its authorization is the Stripe
  signature over the raw body (`STRIPE_WEBHOOK_SECRET`). There is one platform Stripe account
  (`STRIPE_SECRET_KEY`) for all users.
- **Payment rows** have no owner column. Their owner is the owner of `invoice_id`, which is only
  ever set by `/pay` after the invoice owner check. Lookup from the webhook is by
  `provider_payment_id` (the PaymentIntent id our server created).
- **No route returns, edits, deletes or refunds payment rows.** The only readers are the webhook
  and `InvoicesService.calculateInvoiceStatus` (sums completed payments when the owner views an
  invoice). `GET /v1/config/stripe-public-key` returns the publishable key only.

## 2. Payments: per-path classification

| Path / property | Evidence | Class |
|---|---|---|
| `/pay` on another user's invoice | 403 when written; 404 after the non-disclosure change (fix/proxy-host) was merged. No Stripe call, no row; owner control 200 (`refuses to create a payment for another user's invoice`). Killed by removing the owner check in `findOwned` (mutant P2 below) | verified acceptable |
| `/pay` body/query `invoiceId`, `userId`, `amount`, `currency` | ignored: the controller reads only `:id` and the JWT/API-key user. Metadata, row and amount come from the owned invoice | verified acceptable |
| `/pay` with an API key lacking `write:invoices` | **was 200**, now 403 `API key does not have required permission: write:invoices`. Unrestricted (`[]`) and `write:invoices` keys, and JWT, still work | proven flaw → fixed (`2187f1a`) |
| Webhook signature on the raw body | **under `main.ts`, every signed event got 400 "Missing request body"** (see §2.1). Now verified on the untouched bytes. Wrong secret, tampered body and a 600 s old timestamp are rejected with a signature error. The same payload correctly signed is accepted | proven flaw → fixed (`79481ab`) |
| Replay | Stripe's 300 s timestamp tolerance (stripe-node default) bounds replay of a captured payload. Redelivery inside that window is a no-op (state transitions, below). There is no event-id table | verified acceptable for this integration |
| Redelivery / concurrent delivery | **was:** second notification. **Now:** conditional `UPDATE ... WHERE status = <old>` on payment and invoice, so one notification | proven flaw → fixed |
| Out-of-order `payment_failed` after success | **was:** payment back to `failed`. **Now:** completed/refunded payments are final | proven flaw → fixed |
| Amount / currency | **was:** invoice `paid` whatever was received. **Now:** `amount_received` is recorded on the payment (requested amount kept in `metadata_json.requested_amount`). The invoice is paid only when completed payments in its currency cover its **current** total. A currency mismatch or missing amount leaves the payment `pending` with `metadata_json.review_required` | proven flaw → fixed (`aec207c`) |
| Event metadata naming another invoice than the stored payment | not applied. It can only come from someone holding the platform's Stripe secret key | optional hardening (done) |
| Unknown PaymentIntent (e.g. another integration on the same Stripe account) | **was:** 400 → Stripe retries for days and may disable the endpoint. **Now:** 200, nothing changed. Processing errors are 5xx, so Stripe redelivers | proven flaw (operability) → fixed |
| Webhook on a legacy cross-owner invoice (A's invoice → B's client) | notification goes to A, client name `Unknown`, nothing of B's. It already passed once the raw body was fixed (`ownedClient`, earlier work) | verified acceptable |
| Read / alter / delete / refund another user's payment | no such routes exist | verified acceptable (no surface) |
| Sync | no payment object type | verified acceptable (no surface) |
| Refund / dispute events (`charge.refunded`, ...) | not handled; `REFUNDED` is never set; an invoice stays `paid` after a refund in the Stripe dashboard | untested; functional gap, not changed |
| Production middleware other than body parsing (helmet, CORS, rate limits, HTTPS redirect) | not run in tests | untested |

### 2.1 Why the webhook never worked under `main.ts` (P1)

`main.ts` creates the app with `rawBody: true` and also mounts
`express.raw({ type: 'application/json' })` on `/api/v1/webhooks/stripe` before `app.init()`.
NestJS here is **10.4.20** (not 11): it registers its own parsers in `init()`, after user
middleware. `body-parser` 1.20.3 (`lib/read.js:46`) sets `req._body = true`, so Nest's JSON parser
(the one whose `verify` callback fills `req.rawBody`) skips the request. The controller read only
`req.rawBody` and answered 400.

The old E2E test did not use `express.raw` and mocked `verifyWebhookSignature`, so it never
noticed. The new suite bootstraps in `main.ts` order with the real `StripeService`.

The fix uses `req.rawBody`, or else the `Buffer` that `express.raw` left in `req.body`. A parsed
JSON object is never accepted, because re-serialized JSON would not match the signature. The
Buffer goes to `constructEvent` unchanged.

Consequence for deployments: since this route existed, payments in a `main.ts` deployment were
completed only by the app's own `PATCH status=paid` after the payment sheet. Stripe will have
recorded failed deliveries. After deploying, Stripe dashboard → Webhooks shows those, and they can
be resent. They are now safe to replay.

### 2.2 Behaviour changes (compatibility)

- API keys created with explicit permissions now need `write:invoices` (or `write:*` / `*`) for
  `/pay`. Keys with no permissions (`[]`, "all") and JWT sessions are unchanged.
- A succeeded event without `amount_received`/`currency` no longer completes a payment. Real
  Stripe `payment_intent.succeeded` events always carry both. Three existing E2E mocks and one
  historical-cross-owner test were updated to the real shape.
- `PaymentsService.updatePaymentStatus` now returns a `PaymentEventResult` instead of the saved
  `Payment` and no longer throws `NotFoundException`. Its only callers are the webhook controller
  and tests.
- A partial payment no longer marks the invoice paid. The owner can still `PATCH` the status as
  before (the app does this after the sheet).
- Amounts: `amount_received / 100` mirrors how amounts were sent (`total * 100`). This is
  **wrong for zero-decimal currencies** (JPY, KRW, ...) on both sides. That is a pre-existing
  defect (§5) and not changed here.

## 3. Attachment URLs

### 3.1 Trace

| Stage | What happens |
|---|---|
| REST input `POST /v1/invoices/:id/attachments` | multipart file only, no URL input. The server uploads to S3 (private) and stores a **7-day presigned URL** (`https://bucket.s3.region.amazonaws.com/...` or, with the docker-compose default `S3_ENDPOINT=http://minio:9000`, `http://minio:9000/...`) |
| Sync input `POST /v1/sync/push` (attachment create/update) | `url` was free text (ownership already enforced). The shipped app never pushes (`queueChange` unused), so this is reachable with hand-made requests |
| Storage | `attachments.url` varchar(500) (entity); `TEXT` in migration 005 |
| Read `GET /v1/invoices/:id/attachments`, `GET /v1/sync/pull` | URL returned as stored |
| Mobile | `AttachmentViewer` loads `Image.network(url)` and opens `launchUrl(Uri.parse(url), externalApplication)`. `invoice_detail_screen.dart` "download" does the same. Pulled rows are cached in `attachments_local` |
| PDF, email, GDPR export, notifications | attachments are not used |
| Server-side fetch | **none**: no HTTP client in `src/`, and attachment URLs never reach Puppeteer |

### 3.2 Which risk exists

- **Unsafe navigation / unsupported input, in the client.** With a stored `javascript:`, `data:`,
  `file:`, `intent:`, `tel:` or app-specific URL, the app hands it to the OS or browser
  (`url_launcher`, external application) or to `Image.network`. What happens is platform-dependent
  and was not executed: no Flutter SDK here. Since the sync ownership fix, a user can only plant
  such a URL in their **own** account. The cross-account case (an attacker's URL on a victim's
  invoice, `2026-10-25-sync-ownership.md` §1) is historical, and those rows are already hidden by
  `withoutForeignSyncHistory`. So the remaining exposure is mostly self-inflicted or historical
  data. It is fixed as unsupported input, defence in depth.
- **Script execution on a server origin:** none found. The API never renders attachment URLs into
  HTML.
- **SSRF:** not for attachments. The server never fetches them. The validator is a format check
  and **is not SSRF protection**. There is no host allowlist: storage hosts are deployment-specific
  (AWS, MinIO, CDN), and `http:` stays allowed for the documented MinIO setup.
- **Unauthorized file access:** stored S3 keys are not signed or served by any route, so a key
  pointing at another invoice's prefix grants nothing today. If a download route that signs stored
  keys is ever added, it must check that the key belongs to the owner's invoice.

### 3.3 Rule (`backend/src/common/attachment-url.ts`)

Accepted:

- an absolute `http(s)://host...` URL with no credentials;
- or an S3-style object key (`[A-Za-z0-9!_.*'()-]` segments, no leading `/`, no empty, `.` or `..`
  segments).

Rejected: everything else. That includes:

- every other scheme;
- `https:host` without `//`;
- protocol-relative `//host`, and absolute paths;
- whitespace, Unicode spaces and BOM, C0/C1 controls, and backslashes;
- non-strings, and anything over 500 characters.

Applied at:

| Point | Behaviour |
|---|---|
| Sync push create, and update that sets `url` (`sync.service.ts`, one call) | change fails (`failed` count), nothing written. Updates that do not touch `url` still work on historical rows |
| `GET /v1/invoices/:id/attachments` | rows with an invalid stored URL are left out (logged by id). Rows unchanged |
| REST upload | no URL input; the server-generated presigned URL is unchanged |
| `GET /v1/sync/pull` | **not integrated** (§3.4) |
| `clients.controller.ts` | has no attachment routes: nothing to do. Not touched |

### 3.4 Proposed for the coordinator: sync pull filter (outside this branch)

I was asked to touch `sync.service.ts` only at the attachment write path. Pull still returns
historical invalid URLs. Proposed change (`pullChanges`):

```diff
-import { assertValidAttachmentUrl } from '../common/attachment-url';
+import { assertValidAttachmentUrl, withValidAttachmentUrls } from '../common/attachment-url';
@@
-    const attachments = await withoutForeignSyncHistory(
+    const attachments = withValidAttachmentUrls(await withoutForeignSyncHistory(
@@
       userId,
-    );
+    ));
```

I verified it locally and did not commit it. With the patch and the skipped test
`GET /sync/pull leaves out historical invalid URLs` enabled, `attachment-url`, `sync-ownership` and
`sync` passed 48/48. Without the patch, that test fails (it receives the `javascript:` row).

### 3.5 Historical rows

Nothing is modified. Read-only query to find them. It approximates `checkAttachmentUrl`: it agreed
on 28 test values, but the TypeScript function is authoritative. Do not delete rows from it
blindly.

```sql
-- read-only; attachments.url values the API no longer returns or accepts
SELECT id, owner_type, owner_id, left(url, 80) AS url_prefix
  FROM attachments
 WHERE NOT (
  (url ~* '^https?://[^/]' AND url !~ '^[^/?#]*//[^/?#]*@' AND url !~ '[[:space:][:cntrl:]\\]' AND url !~ '[\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]')
  OR (url ~ '^[A-Za-z0-9!_.*''()-]+(/[A-Za-z0-9!_.*''()-]+)*$' AND url !~ '(^|/)\.{1,2}(/|$)')
) OR length(url) > 500;
```

**Devices already holding such URLs** in `attachments_local` keep them until a client-side check
exists (§5).

## 4. Evidence

Environment:

- PostgreSQL 16.15 `initdb` in `/var/tmp/pg-agentA`, port 5433, md5 auth, database
  `invoiceme_test`, synthetic users only. Schema from entities (`DB_SYNCHRONIZE=true`), as in CI.
- Node v22.22.0, `npm ci` with `PUPPETEER_SKIP_DOWNLOAD=true` (the Chrome download returns 403
  through this sandbox's proxy).
- Env vars as in `.github/workflows/ci.yml`, with port 5433.

**Heap:** with Node 22's default heap, a single E2E spec (`payments.e2e-spec.ts`) crashed with
`FATAL ERROR: Ineffective mark-compacts near heap limit` at about 2 GB. All runs used
`NODE_OPTIONS=--max-old-space-size=4096` (E2E as well as unit). This was not investigated here.

### 4.1 Fail before, pass after

| Suite | on `main` code | after |
|---|---|---|
| `payments-authz.e2e-spec.ts` (13) | **11 failed, 2 passed** (the 2: cross-owner `/pay`, body fields; both verified acceptable). Every webhook test failed with `"Missing request body"`; the API-key test with `Expected: 403, Received: 200` | 13 passed |
| after the raw-body fix only (`79481ab`) | 7 failed: redelivery, late failure, coverage, received amount, currency, metadata, unknown PI. The legacy-disclosure test passes from here on | — |
| `attachment-url.e2e-spec.ts` (7) | **4 failed, 2 passed, 1 skipped**. Sync stored all 14 dangerous URLs (`{synced:18, failed:0}` vs expected `{synced:4, failed:14}`) and, in a separate test, an array-valued `url`. GET returned the 3 invalid rows | 6 passed, 1 skipped (pull, §3.4) |

Each denial is on a record the actor owns, or has a legitimate-owner positive control in the same
test. The tests assert the error message or the database state, so that the intended check is what
blocks the request.

### 4.2 Mutation checks (one check removed at a time; scripts not committed)

Payments (E2E `payments-authz`, 13 tests; unit `payments.service` + `webhooks.controller`, 60 tests):

| Mutant | Killed by |
|---|---|
| no `@RequirePermission` on `/pay` | E2E: API-key test |
| invoice owner check removed (`findOwned`) | E2E: cross-owner `/pay`, API-key test |
| no raw-body fallback | E2E: 10 webhook tests |
| metadata invoice check removed | E2E: metadata test |
| final-status check removed | E2E: late `payment_failed` |
| currency check removed | E2E: currency test |
| received amount not recorded | E2E: received-amount test |
| coverage check removed | E2E: coverage + received-amount tests |
| unknown payment throws (old) | E2E: unknown-PI test |
| same-status duplicate check removed | E2E survives (the final-status check also catches it); unit kills |
| payment transition unconditional | E2E survives (only matters under concurrency); unit kills |
| invoice transition unconditional | survived both at first; unit assertion tightened (`e880479`), now killed |
| processing errors mapped to 400 again | E2E survives (no E2E fault injection); unit kills |

Attachments (E2E `attachment-url`, 6 active; unit `attachment-url.spec`, 58):

| Mutant | Killed by |
|---|---|
| sync validator call removed | E2E: 3 tests |
| validator only on create | E2E: update test |
| validator also on updates that don't set `url` | E2E: historical-row edit test (compatibility) |
| GET filter removed | E2E: GET test |
| credentials check removed | E2E + unit |
| storage-key pattern accepts anything | E2E + unit |
| dot-segment check removed | E2E + unit |
| scheme allowlist removed | unit (15 cases). The E2E cases are still rejected by the authority-form check (layered) |
| authority-form check removed | unit (4). E2E layered |
| forbidden-character check removed | unit (12). E2E layered |
| type check removed | does not compile |

Not tested at the database level: true concurrency (two deliveries racing); covered by unit tests
only.

### 4.3 Full runs (in `backend/`)

| Check | Command | `main` (`cac08e1`) | HEAD |
|---|---|---|---|
| Unit | `NODE_OPTIONS=--max-old-space-size=4096 npx jest` | 21 suites, 372 passed | 22 suites, **444 passed**, 0 failed, 0 skipped |
| E2E | `npm run test:e2e` (CI env, `DB_SYNCHRONIZE=true`) | 10 suites, 157 passed, 1 skipped | 12 suites, **176 passed, 0 failed, 2 skipped** |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | | exit 0 |
| Build | `npm run build` | | exit 0 |

The 2 skipped E2E tests:

- the sync pull filter (§3.4);
- `verify-restore` "Unix socket", which needs a socket directory and is skipped on `main` too.

Real vs mocked:

- **Real:** PostgreSQL; the Nest app with guards and pipes; JWT and API-key authentication; Stripe
  HMAC signature verification.
- **Mocked:** `StripeService.createPaymentIntent` / `retrievePaymentIntent`, `NotificationService`,
  `EmailService` and `S3Service`. No network calls.
- **Not exercised:** the Flutter app, the SQL migrations schema, PostgreSQL 15 / Node 20 (the CI
  versions), and a real Stripe account.

## 5. Remaining issues (not fixed here)

1. **Sync pull filter**: §3.4, needs integration.
2. **Mobile client check (recommended).** Devices cache attachment URLs, so server filtering does
   not clean an existing device. A guard before `launchUrl` / `Image.network` in
   `mobile/lib/widgets/attachment_viewer.dart` and `screens/invoice_detail_screen.dart`, allowing
   only `http`/`https`, would cover cached rows. Not done: `mobile/` is outside this branch, and
   there is no Flutter SDK here to test it.
3. **`pdfLogoUrl` (user settings) is fetched by the server's Chromium** (`<img src>`, `networkidle0`
   in `pdf.service.ts`). It accepts any string (`@IsString()` only). This is a **server-side
   request to a user-chosen URL**, so it is a plausible SSRF surface (internal addresses, metadata
   endpoints). It is unrelated to attachments, **untested**, and outside this branch. Needs its own
   review: scheme and destination policy, or request interception in Puppeteer, redirects, size
   and time limits.
4. Other invoice routes lack `@RequirePermission`, so any API key passes `PermissionGuard`:
   `send`, `attachments` upload/list, `pdf`, `duplicate`, `convert`, `export/csv`, `import/csv`,
   `bulk-archive`. They are owner-scoped, but not scope-checked. This is the same class as P2 and
   outside the payments scope. Not changed.
5. Refunds and disputes are not handled (§2).
6. Zero-decimal currencies: `createPaymentIntent` always multiplies by 100. A JPY invoice of 1000
   would request ¥100,000. This is a pre-existing money bug, not authorization.
7. `payments.metadata_json` stores the PaymentIntent `client_secret` (at creation) and now the full
   webhook object, as it did before. It is not exposed by any route. Optional hardening: don't
   persist `client_secret`.
8. Every `/pay` call creates a new PaymentIntent. Several open intents can each be paid, and each
   counts. This is a product decision.
9. A succeeded payment still marks a cancelled or soft-deleted invoice paid (existing behaviour
   kept: money was received). `calculateInvoiceStatus` ignores currency (it only differs if the
   invoice currency changed after payment). Both are product decisions.
10. Presigned attachment URLs expire after 7 days, so stored links stop working. This is
    functional, not security. The fix would be to store the key and sign on read with an owner
    check (see §3.2).
11. Operators: list payments flagged by the new checks (read-only):
    `SELECT id, invoice_id, provider_payment_id, metadata_json->'review_required' FROM payments WHERE metadata_json ? 'review_required';`

## 6. Commits

```
fa45364 test(payments): add authorization and signed-webhook regression tests
2187f1a fix(invoices): require write:invoices for API keys on POST /:id/pay
79481ab fix(webhooks): verify Stripe signatures on the raw bytes under main.ts
aec207c fix(payments): make webhook processing idempotent and amount-checked
e880479 test(payments): pin the conditional invoice-paid update
3d8828b test(attachments): add attachment URL regression tests
b57b592 fix(attachments): validate attachment URLs on sync push and REST read
f16a4f9 test(historical-cross-owner): pass the payment intent the webhook passes
```

Files outside the listed ownership:

- `backend/test/historical-cross-owner.e2e-spec.ts`: one call now passes a realistic payment
  intent (`f16a4f9`).
- `backend/src/sync/sync.service.ts`: only the validator call and its import, as agreed.

`backend/src/clients/clients.controller.ts` was not changed (it has no attachment routes).

Deploy: no migration and no schema change. Deploy the backend; no mobile release is needed. After
deploying, failed webhook deliveries can be resent from the Stripe dashboard (§2.1). §5 items 1–4
remain open.
