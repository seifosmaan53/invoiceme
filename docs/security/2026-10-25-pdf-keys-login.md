# PDF rendering network access, API-key scopes on invoice routes, login 500 (2026-10-25)

- **Branch:** `fix/pdf-logo-and-key-scopes` on `integration/completion-pass` (`dcda900`). Not pushed (no remote).
- **Scope:** `core/services/pdf*.ts` (new: `pdf-logo.ts`, `pdf-render-sandbox.ts`), `user-settings` DTO/service,
  `@RequirePermission` on `invoices.controller.ts` (not `/:id/pay`) and on `clients.controller.ts` bulk-archive,
  refresh-token issuing in `auth.service.ts`.
- **Builds on:** `2026-10-25-container-pdf.md` (Chromium in the image), `2026-10-25-payments-attachments.md`
  (`/pay` scope, P2). Not repeated here.
- **Evidence:** disposable local PostgreSQL 16, synthetic users, real Chromium (Chrome for Testing 153.0.8010.12) on the
  host. Email, notifications and S3 are mocked; PdfService is stubbed in the HTTP suites only. No external service was
  contacted. Nothing was deployed and no data was modified anywhere.

## 0. Summary

| # | Finding | Class | Fixed |
|---|---|---|---|
| E1a | `pdfLogoUrl` is loaded by the server's Chromium during PDF generation: a server-side request to any URL the user picks, including loopback, private and metadata addresses | proven flaw (SSRF) | yes |
| E1b | Same through `pdfFontFamily` (≤ 50 chars, inserted unescaped into CSS: `x}body{background:url(http://…)}`), settable through `PATCH /user-settings` | proven flaw (SSRF, CSS injection) | yes |
| E1c | Same through the invoice number, inserted **unescaped** into the HTML (`<img src=…>`). `number` is settable through sync push | proven flaw (SSRF, HTML injection into PDFs) | yes |
| E1d | Chromium's request interception alone does not stop `<link rel=prefetch>` (full GET), preconnect, or the connections made for iframe/object/meta-refresh | proven (design input for the fix) | covered by browser flags |
| E1e | First version of the safe logo fetcher let IP literals bypass the address check (Node skips `lookup` for IP hosts) | found by own test before commit | yes |
| E2 | 9 invoice routes and clients bulk-archive have no `@RequirePermission`; `PermissionGuard` lets any API key through such routes, so a `read:*` key can duplicate, convert, send, upload, import and archive | proven flaw (authorization scope; same class as P2) | yes |
| E3 | Two logins of the same user in one second → HTTP 500 (`duplicate key value violates unique constraint` on `refresh_tokens.token`) | proven flaw (availability) | yes |

## 1. E1: PDF rendering and the logo

### 1.1 Confirmation

`backend/test/pdf-network.spec.ts` runs the real `PdfService` with a real Chromium and a plain TCP listener on
`127.0.0.1` that counts connections and records request lines. On the base code (commit `abf964c`, test only):

| Input | Listener recorded |
|---|---|
| `settings.logoUrl = http://127.0.0.1:<port>/logo.png` | `GET /logo.png HTTP/1.1` |
| `settings.fontFamily = x}body{background:url(http://127.0.0.1:<port>/f)}` | `GET /f HTTP/1.1` |
| `invoice.number = <img src="http://127.0.0.1:<port>/n.png">` | `GET /n.png HTTP/1.1` |

Both HTTP routes that render (`POST /invoices/:id/pdf`, `POST /invoices/:id/send`) pass the stored `pdfLogoUrl`,
`pdfFontFamily` and the invoice to `generateInvoicePdf()`. The PDF bytes go back to the user, so a response that
Chromium renders (an image, or text in an iframe) is readable, not just blind.

### 1.2 What interception does not catch (measured)

Probe: plain Chromium, `setRequestInterception(true)` + abort-all + JavaScript disabled, one element per run:

| Element | Without the browser flags | With `PDF_BROWSER_ARGS` |
|---|---|---|
| `<img>`, stylesheet, `@import`, `@font-face`, CSS `url()`, `<svg><image>`, video poster, audio | 0 connections (blocked by interception) | 0 |
| `<link rel=preconnect>` | **1 connection** (TCP, no request) | 0 |
| `<link rel=prefetch>` | **1 connection, `GET /pf`** | 0 |
| `<iframe>`, `<object>` | **1 connection** | 0 |
| `<meta http-equiv=refresh>` | **2 connections** | 0 |
| hostnames, with `http_proxy`/`HTTPS_PROXY` in the environment pointing at the listener, **no flags, no interception** | `GET http://example.invalid/pf`, `GET http://example.invalid/i`, and `CONNECT accounts.google.com:443` | 0 |

So request interception is not enough on its own. The browser flags do the main work.

### 1.3 Fix

Rendering never fetches anything from the network:

1. **`PDF_BROWSER_ARGS`** (`pdf-render-sandbox.ts`) on both launch paths (`PdfService`, `PdfCacheService`):
   `--host-resolver-rules=MAP * ~NOTFOUND` (every host, IP literals included, fails to resolve: measured above),
   `--no-proxy-server`, `--dns-prefetch-disable`, `--disable-background-networking`, `--disable-component-update`,
   `--disable-domain-reliability`, `--disable-sync`, `--no-pings`.
2. **`lockDownPage(page)`**: JavaScript disabled, request interception aborts everything except `data:` and
   `about:blank`. `PdfService` uses it on its page; `PdfCacheService.newPage()` is the locked-down way to get a page
   from the shared browser (`getBrowser()` is unchanged for the smoke test).
3. **Template values**: invoice number, status, currency and quantity are HTML-escaped. Colours must match
   `#rrggbb` and the font `[A-Za-z0-9 -]{1,50}`, otherwise the default is used. This also covers historical rows.
   Replacements use function replacers, so `$&`-style patterns in user data are not expanded.

The logo is now fetched **by the server** (`pdf-logo.ts`, `fetchLogoAsDataUri`) and inlined as a `data:` URI:

- Input rule (`checkPdfLogoUrl`): absolute `https://` URL with a host; port 443 only; no credentials; no whitespace,
  controls, Unicode spaces or backslashes; at most 2048 characters.
- Address policy (`isPublicAddress`, `net.BlockList`): refuses 0/8, 10/8, 100.64/10 (incl. 100.100.100.200), 127/8,
  169.254/16 (incl. 169.254.169.254), 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15,
  198.51.100/24, 203.0.113/24, 224/4, 240/4; `::`, `::1`, 64:ff9b::/96, 64:ff9b:1::/48, 100::/64, 2001::/23 (Teredo
  etc.), 2001:db8::/32, 2002::/16 (6to4), fc00::/7 (incl. `fd00:ec2::254`), fe80::/10, fec0::/10, ff00::/8. IPv4-mapped
  and IPv4-compatible IPv6 (`::ffff:127.0.0.1`, `::ffff:7f00:1`, `::127.0.0.1`) are unwrapped and checked as IPv4.
- **Checked at connect time:** the check runs in the socket's `lookup` callback, so the address that passed is the
  address connected to (no DNS-rebinding window). The request is refused if *any* resolved address is refused. IP
  literals are checked before the request is created, because Node does not call `lookup` for them (E1e).
- No redirects (any non-200 is a failure). 5 s overall timeout. 1 MiB body limit (declared `Content-Length` and
  streamed bytes). `Content-Type` must be PNG, JPEG, GIF or WebP **and** the body's magic bytes must match.
  No SVG. TLS is verified normally. `agent: false` (no pooled sockets), no cookies.
- Any refusal or failure → the PDF is rendered **without** the logo, and a warning is logged (without the URL).
  A missing logo never fails the invoice.
- Historical stored values that fail the input rule (e.g. `http://…`, `javascript:`, `data:`) are never handed to the
  fetcher. Nothing is rewritten in the database.

`PATCH /v1/user-settings` (`user-settings.service.ts`, `dto`): a **new** `pdfLogoUrl` must pass `checkPdfLogoUrl`
(400 with the reason). An unchanged value is accepted as is, because the app sends the whole settings object back on
every save (`settings_screen.dart:863`): a user with a historical `http://` logo can still change colours. `null`/`""`
removes the logo. `pdfFontFamily` must match `^[A-Za-z0-9 -]+$` (all six fonts offered by the app pass).

No hostname allowlist was added: logo hosts are arbitrary customer CDNs, and an allowlist needs a config plan that
does not exist.

### 1.4 Evidence

`test/pdf-network.spec.ts` (real Chromium, 11 tests):

| Test | Result |
|---|---|
| the three E1a–c inputs | 0 connections; PDF renders |
| logo fetched by the server (fetcher mocked) | 1×1 image present in the PDF (`/Width 1`), absent without logo; 0 browser connections |
| server-side fetch fails | PDF renders, no logo |
| historical `http://127.0.0.1…`, `javascript:`, `file:`, `data:image/svg+xml` | fetcher never called; 0 connections |
| raw hostile page (all element kinds of §1.2) on `PdfCacheService.newPage()` | 0 connections; PDF renders |
| same page on a page **without** interception (flags only) | 0 connections |
| hostname URLs with `http_proxy`/`HTTPS_PROXY`/`all_proxy` pointing at the listener | 0 connections |
| control: plain browser, no flags, no interception | ≥ 3 requests reach the listener |
| plain browser + `lockDownPage()` only, intercepted kinds | 0 connections, ≥ 3 URLs recorded as blocked |

`test/pdf-logo.spec.ts` (local HTTPS server with a throwaway self-signed cert, 67 tests): input rule table (3 accepted,
18 rejected), address table (25 refused, 4 allowed), positive control (PNG inlined, 1 connection), real policy
refuses `logo.test → 127.0.0.1` **with 0 TCP connections**, mixed public/private answer refused, IP literals
`127.0.0.1`, `[::1]`, `169.254.169.254`, `[::ffff:127.0.0.1]` refused without connecting, input rule applied before any
lookup, redirect not followed (target never requested), `text/html` / `image/svg+xml` / missing type refused, PNG
type with HTML body refused, `Content-Length` and streamed size limits, timeout, untrusted certificate refused.

`test/user-settings-logo.e2e-spec.ts` (HTTP, PostgreSQL, 11 tests): https accepted; null/"" remove; http,
loopback, `javascript:`, `file:`, `data:`, credentials, port 8443, malformed → 400 with the stored value unchanged;
historical value round-trip saves other fields and is not rewritten, but cannot be changed to another invalid value;
font rule.

Mutations (each restored afterwards):

| Mutation | Result |
|---|---|
| base code (no fix) | 3/3 E1 tests fail with the GETs above |
| `PdfCacheService` without `PDF_BROWSER_ARGS` | 3 browser-layer tests fail (incl. the proxy test) |
| `PdfService` without flags, without `lockDownPage`, without number escaping | the invoice-number test fails |
| `PdfService` without escaping and font rule, browser layers kept | all pass: the browser layers alone hold |
| `user-settings.service` without `checkPdfLogoUrl` | 9 of 11 settings tests fail (the rejections and the round-trip) |

PDF generation still works:

- `test/container/pdf-smoke.js` against the **host** build: `SMOKE_DIST_DIR=backend/dist/src`,
  `PUPPETEER_EXECUTABLE_PATH` = Chrome for Testing 153.0.8010.12, proxy variables unset. Exit 0. Service PDF:
  `%PDF-` … `%%EOF`, 2 pages, `Skia/PDF m153`, invoice number found by `pdftotext`. Cache PDF: 1 page, number found.
  The log shows `Using Chrome executable: …/chrome`.
- **The container image was not built or run here** (Alpine mirrors are blocked in this sandbox, see the container
  report). The CI "Container PDF smoke test" step is the check. The new flags are standard Chromium switches. The
  Chrome 124 / Alpine path was not re-verified.

### 1.5 Compatibility

- `http://` logos no longer appear in PDFs, and a new `http://` value is refused (the mobile dialog still allows
  `http://`, `settings_screen.dart:1135`; the server's 400 message says `https://`). This is a product change.
  The reason: the fetcher only does https.
- Logos must be PNG/JPEG/GIF/WebP, ≤ 1 MiB, answered within 5 s, without redirects (a CDN URL that redirects stops
  working). SVG logos stop working.
- The fetch makes a **direct** outbound connection. A deployment that only has egress through an HTTP proxy will get
  PDFs without logos. Proxy support would need its own design: the proxy resolves the name, so the address check
  would have to move there.
- Every render fetches the logo again (no cache), which adds up to 5 s when the host is slow.
- Font families outside `[A-Za-z0-9 -]` are refused on input and fall back to Arial when rendering.

### 1.6 Historical rows (read-only)

```sql
-- logo URLs the renderer now ignores, and font families it replaces with Arial
SELECT user_id, left(pdf_logo_url, 80) AS logo_prefix, pdf_font_family
  FROM user_settings
 WHERE (pdf_logo_url IS NOT NULL AND pdf_logo_url <> ''
        AND pdf_logo_url !~* '^https://[^/?#@:\s]+(:443)?([/?#][^\s\\]*)?$')
    OR (pdf_font_family IS NOT NULL AND pdf_font_family !~ '^[A-Za-z0-9 -]{1,50}$');
```

This approximates `checkPdfLogoUrl` (it agreed on 7 sample values; it also flags IPv6-literal hosts, which the rule accepts and the fetcher then refuses as non-public anyway). The TypeScript function is authoritative: do not delete or rewrite rows from it.

## 2. E2: API-key permissions

### 2.1 Model (from code)

- `ApiKeyOrJwtGuard`: an `X-API-Key` header or a `Bearer sk_…` token selects API-key auth. It sets `request.apiKey`
  and `request.user = { userId }`. Anything else falls back to the JWT strategy.
- `PermissionGuard`: reads `@RequirePermission(p)`. **No decorator → allow**. No `request.apiKey` (JWT login) →
  allow. Otherwise `ApiKeysService.hasPermission`: an empty permission list allows everything (legacy keys). It also
  accepts an exact match, `action:*`, or `*`.
- Only `InvoicesController` and `ClientsController` use these guards. Every other controller is JWT-only, so API keys
  are refused there.

### 2.2 Routes changed

| Route | Permission | Reason |
|---|---|---|
| `POST /invoices/:id/duplicate` | `write:invoices` | creates an invoice |
| `POST /invoices/:id/convert` | `write:invoices` | creates an invoice / changes the estimate |
| `POST /invoices/:id/send` | `write:invoices` | emails the client, uploads the PDF |
| `POST /invoices/:id/attachments` | `write:invoices` | uploads, inserts a row |
| `POST /invoices/import/csv` | `write:invoices` | creates invoices |
| `POST /invoices/bulk-archive` | `delete:invoices` | same as `DELETE /invoices/:id` |
| `GET /invoices/:id/attachments` | `read:invoices` | read |
| `GET /invoices/export/csv` | `read:invoices` | read |
| `POST /invoices/:id/pdf` | `read:invoices` | renders existing data (export). Side effect: with S3 configured it overwrites the derived `pdfs/<id>/<number>.pdf` object. Classified as a read on purpose; use `write:invoices` if the owner prefers |
| `POST /clients/bulk-archive` | `delete:clients` | same as `DELETE /clients/:id` |

The routes that already had a permission (list, get, create, update, delete, stats, `/pay`, every other clients route)
are unchanged. The clients controller had the same gap only on bulk-archive.

### 2.3 Evidence

`test/api-key-scopes.e2e-spec.ts` (HTTP, PostgreSQL, 32 tests). For each of the 10 routes:

- a valid key of the same owner that lacks the permission gets 403 with exactly
  `API key does not have required permission: <p>`, and the effect is unchanged (invoice / attachment / archived
  counts, and the email / upload / PDF mock call counts);
- a key with exactly that permission succeeds;
- the owner's JWT succeeds.

Also: a read-only key can still use every read route, and a legacy key (`[]`) keeps full access.
`test/api-key-permissions.spec.ts` (unit, 50 tests) walks the route metadata of both controllers. It requires a
permission on every route, `read:` on GETs, and `write:`/`delete:` on non-GETs (`:id/pdf` is the documented exception).

Mutations: with all 10 decorators removed (commit `a05cca8`), exactly the 10 denial tests fail and the 22 positive
controls pass, so the 403s come from the permission check and not from validation or another guard. With each decorator
removed **one at a time**, exactly that route's denial test fails (10 runs, 1 failed / 31 passed each).

### 2.4 Compatibility

API keys created **with explicit permissions** now need `write:invoices` / `delete:invoices` / `delete:clients` for the
routes above, and `read:invoices` for the reads. JWT sessions and legacy keys with no permissions are unaffected. The
Flutter app uses JWT only.

## 3. E3: login 500

Cause: `generateTokens()` signed the refresh token as `{ sub }` with `iat`/`exp` only. Two logins in the same second
produced identical strings, and the second `INSERT` violated `UQ_…` on `refresh_tokens.token`. The exception handler
answered 500.

Reproduction (`test/login-refresh-unique.e2e-spec.ts`, `Date.now` pinned inside one second, commit `4b6fe73`): 2
sequential logins → second is 500. 3 concurrent logins → 500s. The PostgreSQL log shows
`duplicate key value violates unique constraint "UQ_4542dd2f38a61354a040ba9fd57"`.

Fix: `jwtid: crypto.randomUUID()` on the refresh token. The secret, `JWT_REFRESH_EXPIRES_IN` (default 7 d), the 7-day
row expiry, the lookup by token string in `refresh()`, and the delete-then-issue rotation are unchanged. Tokens issued
before the change stay valid. Access tokens are unchanged (they are not stored).

After the fix: both logins 200 with different tokens, 2 rows. 3 concurrent → 200 ×3, 3 distinct tokens. The token
still verifies with the refresh secret, `exp - iat = 7 d`, and the row expires in 7 days. A refresh in the same second
works and returns a new token. The used token → 401. The other session's token still refreshes. Garbage → 401.
`auth.e2e-spec.ts` and the auth unit specs pass.

## 4. Test runs (this branch, final state)

| Run | Passed | Failed | Skipped |
|---|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=4096 npx jest` (unit; real Chromium in `pdf-network.spec`, local HTTPS in `pdf-logo.spec`) | 605 (26 suites) | 0 | 0 |
| `npm run test:e2e` (`DB_TEST_*`, `DB_SYNCHRONIZE=true`, PostgreSQL 16, heap 6 GB) | 264 (18 of 19 suites) | 2 | 1 |
| `npx tsc --noEmit` | ok | | |
| `npm run build` | ok | | |

The 2 E2E failures are in `payments-authz.e2e-spec.ts` (not owned here). They fail the same way on
`integration/completion-pass` **before** any change on this branch (first harness run): the test expects 403 for
another user's invoice, and the merged non-disclosure work answers 404. One test or the other needs reconciling by
the coordinator. The 1 skip is a pre-existing environment-conditional test (`proxy-https` LAN / `verify-restore`
Unix socket).

CI notes: `pdf-network.spec.ts` needs a Chromium. It uses `PUPPETEER_EXECUTABLE_PATH`, `/usr/bin/google-chrome`
(present on GitHub's ubuntu runners), `/usr/bin/chromium(-browser)` or `/opt/pw-browsers`. If none is found it
**skips with a warning**. `pdf-logo.spec.ts` needs `openssl` on PATH. The E2E suites needed a 6 GB heap here (OOM at
the 2 GB default), as did the existing ones.

## 5. Remaining issues and proposals (not done)

- **`PermissionGuard` fails open** for API keys on routes without a decorator. That is the root cause of E2 and P2.
  Proposal (in `auth/guards`, outside this task): deny API keys when no permission is declared. The route-table unit
  test protects the two controllers in the meantime.
- **Mobile:** the logo dialog accepts `http://`. Proposed: require `https://` (server rule). Not changed (not owned).
- Logo fetch: no egress-proxy support, no caching, no SVG (§1.5).
- Pre-existing template bug, not changed: with no due date, `{{/if}}` is replaced **globally** by `-->`. This can
  comment out later sections of the PDF.
- Observation: host `npm run build` emits `dist/src/**` (because `migrations/data-source.ts` is compiled too). The
  smoke script's default `/app/dist/core/services` and the Dockerfile's `dist/main.js` assume `dist/**`. This is the
  same on `main`. Whether the image has the same layout was not checked here.
- Zero-decimal currencies, refunds etc.: see the payments report. Not touched.
