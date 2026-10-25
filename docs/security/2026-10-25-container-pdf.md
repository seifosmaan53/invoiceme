# Container build stall and PDF generation in the backend image

Date: 2026-10-25 · Branch: `security/sync-ownership` (base `07ca855`)

## Summary

CI's "Build Docker image" step (`docker build -t invoiceme-backend:ci ./backend`)
hangs inside `RUN npm ci`. The cause is Puppeteer's `postinstall` script, which
downloads Chrome-for-Testing builds with an HTTP client that has no timeout. The
download was also useless: the browser it fetches is a glibc build that cannot
run on `node:20-alpine`, and it is written to `/root/.cache/puppeteer`, which
the production stage never copies. So the image could not generate PDFs even
when the build succeeded.

The fix skips the download in the build stages and installs Alpine's own
Chromium in the production stage. Both browser launch paths now point at
Alpine's Chromium through `PUPPETEER_EXECUTABLE_PATH`. A container smoke test in
CI renders a synthetic invoice through the real PDF code inside the image. The
docker steps now have timeouts, so a stall fails the job instead of hanging it.

## Cause (verified)

1. `puppeteer@21.11.0` declares `"postinstall": "node install.mjs"`
   (`node_modules/puppeteer/package.json:41`). `install.mjs` calls
   `downloadBrowser()` (`puppeteer/lib/cjs/puppeteer/node/install.js`). That
   function installs both `chrome` and `chrome-headless-shell` build
   `121.0.6167.85` (`puppeteer-core/.../revisions.js`) unless
   `PUPPETEER_SKIP_DOWNLOAD` is set.
2. Download host: `@puppeteer/browsers@1.9.1` uses
   `https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing` as the default
   base URL (`browser-data/chrome.js:29`, `chrome-headless-shell.js:28`).
   Observed URL:
   `https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/121.0.6167.85/linux64/chrome-linux64.zip`.
3. No timeout: `httpRequest()` in `@puppeteer/browsers/lib/cjs/httpUtil.js`
   calls `https.request(...)` with no `timeout` option and no socket or idle
   timer.
4. The Dockerfile never set `PUPPETEER_SKIP_DOWNLOAD`. CI's host install sets
   it, which is why only the Docker step hangs.

Evidence:

| Experiment | Result |
|---|---|
| Real `install.mjs` (host, node 22), default host through this sandbox's proxy | fails in 1 s: `Download failed: server returned code 403. URL: https://edgedl.me.gvt1.com/.../121.0.6167.85/linux64/chrome-linux64.zip` |
| Real `install.mjs`, `PUPPETEER_DOWNLOAD_BASE_URL` pointed at a local TCP listener that accepts and never answers | still running after 90 s, killed by `timeout` (exit 124). The script never gives up. |
| Original Dockerfile, `--target deps` (proxy CA available, no proxy inside build) | `npm error command sh -c node install.mjs` / `Failed to set up chrome-headless-shell v121.0.6167.85` / `getaddrinfo ENOTFOUND edgedl.me.gvt1.com` after 34 s |
| Fixed Dockerfile, `--target deps` / `--target builder`, no cache | succeed in 58 s / 184 s; `/root/.cache` does not exist |

**Not reproduced:** the indefinite hang inside `docker build` on a GitHub
runner. In this sandbox the download host is unreachable, so the request fails
fast (403 / ENOTFOUND) instead of hanging. The hang mechanism (a request with
no timeout against an endpoint that accepts and does not respond) is
reproduced above with the real script. Why `edgedl.me.gvt1.com` does not
respond from GitHub's runners was not observed.

### Why the old image could not render PDFs anyway (verified)

- Puppeteer 21's default cache is `path.join(os.homedir(), '.cache', 'puppeteer')`
  (`puppeteer/lib/cjs/puppeteer/getConfiguration.js:107-112`), which is
  `/root/.cache/puppeteer` in the `deps` stage. The production stage copies only
  `/app/node_modules`, `/app/dist` and `package.json`.
- `detectBrowserPlatform()` reports `linux` on Alpine, so a `linux64` glibc build
  is fetched. Running the same Chrome-for-Testing 121.0.6167.85
  `chrome-headless-shell` (fetched from `storage.googleapis.com/chrome-for-testing-public`)
  in `node:20-alpine` gives `sh: /c/chrome-headless-shell: not found`, exit 127.
  `file` shows `interpreter /lib64/ld-linux-x86-64.so.2`, which does not exist
  on musl.
- `PdfCacheService.getBrowser()` passed no `executablePath`.

## Fix

`backend/Dockerfile`
- `ENV PUPPETEER_SKIP_DOWNLOAD=true` in `deps` and `deps-dev` (and so `builder`).
- `npm ci --only=production` becomes `npm ci --omit=dev` (npm 10 prints
  "Use `--omit=dev`"; same behaviour).
- The production stage installs `chromium nss freetype harfbuzz ca-certificates font-freefont`
  next to `curl`, and sets
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` and
  `PUPPETEER_SKIP_DOWNLOAD=true`. The runtime user is still `nodejs` (uid 1001).
- Base image and puppeteer version are unchanged (no dependency changes).

`backend/src/core/services/pdf-cache.service.ts`
- `executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined`.
  `PdfService` already read the variable (`getChromeExecutablePath()`). Puppeteer
  21 also reads it itself (`getConfiguration.js:58-59`), but now both launch
  sites say so explicitly.

`backend/test/container/pdf-smoke.{sh,js}`
- `pdf-smoke.sh IMAGE` refuses images whose `Config.User` is empty, `root` or `0`.
  It pipes `pdf-smoke.js` into `docker run --rm -i --network none IMAGE node -`,
  so the image's own user is used, nothing is added to the image, and there is
  no network.
- Inside the container, the script loads the compiled
  `/app/dist/core/services/pdf.service.js` and `pdf-cache.service.js`. It renders
  a synthetic invoice (`SMOKE-INV-<epoch>`, fake client data) through
  `PdfService.generateInvoicePdf()`, and a page through
  `PdfCacheService.getBrowser()`.
- Checks on the host:
  - uid is not 0;
  - PdfService logged `Using Chrome executable: $PUPPETEER_EXECUTABLE_PATH`;
  - PdfCacheService's browser process spawnfile equals that path;
  - each PDF starts with `%PDF-` and ends with `%%EOF`;
  - `pdfinfo` parses each PDF with `Pages >= 1`;
  - `qpdf --check` passes, if qpdf is installed;
  - `pdftotext` output contains the invoice number.
- `test/` is already in `.dockerignore`, so the smoke script is not shipped.

`.github/workflows/ci.yml`
- `timeout-minutes: 20` on "Build Docker image".
- New step "Container PDF smoke test" (`timeout-minutes: 10`), placed after it.
  It installs `poppler-utils` if missing and runs the script on `invoiceme-backend:ci`.
- Existing steps are unchanged.

## Verification performed (this sandbox)

Sandbox constraints, and how they were handled:
- Docker Hub answered 429, so `node:20-alpine` was pulled from `mirror.gcr.io`
  (digest `sha256:fb4cd12c…`; Alpine 3.23.4, node v20.20.2).
- TLS is intercepted inside build containers. A **local-only** tag
  `node:20-alpine` adds the sandbox proxy CA (`NODE_EXTRA_CA_CERTS`). Without it,
  npm failed with `SELF_SIGNED_CERT_IN_CHAIN`, printed `Exit handler never called!`,
  and the `RUN` step still exited 0.
- `dl-cdn.alpinelinux.org` and every other Alpine mirror tried are blocked
  (CONNECT 403 / DNS failure). So the committed `apk add` line cannot run here:
  the full build stops at that step with
  `fetching .../v3.23/main/x86_64/APKINDEX.tar.gz: DNS: name does not exist`.

So the runtime was verified with `Dockerfile.verify`: the committed
Dockerfile with exactly two edits. The production `FROM` is replaced by
`mirror.gcr.io/zenika/alpine-chrome:with-node` (Alpine 3.19.4, `chromium-124.0.6367.78-r0`,
`nss-3.99-r0`, `freetype-2.13.2-r0`, `harfbuzz-8.3.0-r0`, `font-freefont-20120503-r4`,
`nodejs-20.15.1-r0`; plus `USER root` / `ENTRYPOINT []`), and the `apk add` block
is dropped. All other lines are the committed ones: deps stages, user creation,
`COPY --chown`, ENV, `USER nodejs`.

| Check | Result |
|---|---|
| `docker build --no-cache -f Dockerfile.verify` | exit 0, 170 s (`npm ci --omit=dev` 32 s, `npm ci` 124 s) |
| `pdf-smoke.sh invoiceme-backend:verify` | `SMOKE PASS: HeadlessChrome/124.0.6367.78 via /usr/bin/chromium-browser as uid 1001 (puppeteer 21.11.0, node v20.15.1)`. service.pdf about 104 KB, 2 pages, `Skia/PDF m124`; cache.pdf about 5.8 KB, 1 page; both contain the invoice number. Took 5 s. |
| Negative control: committed Dockerfile without the `apk add` block | smoke fails: `Failed to launch the browser process! spawn /usr/bin/chromium-browser ENOENT`, exit 1 |
| Protocol range: same smoke script on the host build, `PUPPETEER_EXECUTABLE_PATH` = Chrome for Testing 153.0.8010.12 | both paths render; `Skia/PDF m153`, 2 pages / 1 page, invoice number found |
| `npm run build` | exit 0 |
| `npm test` (default) | 16/17 suites passed. `test/local-auth.guard.spec.ts` "failed to run" because its jest worker hit the ~2 GB heap limit (Mark-Compact at 2045 MB, then SIGTERM). The suite passes alone (3/3). An earlier default run showed 15 suites failing to run, 21/21 tests passing. |
| `NODE_OPTIONS=--max-old-space-size=4096 npm test` | 17/17 suites, 331/331 tests |

No unit test imports `pdf-cache.service`. Whether the default-heap jest failure
also happens at `07ca855` was not checked.

## Not verified

- **The committed production stage was never built here.** Unverified: that the
  Alpine 3.23 packages exist under these names (`font-freefont` in particular;
  Puppeteer's docs use the older `ttf-freefont`), the Chromium version they
  install, and that `/usr/bin/chromium-browser` exists in that package (it does
  in Alpine 3.19). The first CI run of the build + smoke steps is the check. A
  wrong package name fails at `apk add`; a wrong path fails the smoke test with
  `ENOENT`.
- Puppeteer 21.11.0 is verified against Chromium 124 (Alpine/musl) and Chrome
  153 (glibc). Alpine 3.23's Chromium version is not known from here.
- The `zenika` base used for verification sets
  `CHROMIUM_FLAGS=--disable-software-rasterizer --disable-dev-shm-usage`, and the
  plain Alpine package does not. The app already passes `--disable-dev-shm-usage`
  itself.
- Final image size with Alpine Chromium was not measured. The verification image
  is 1.89 GB, but most of that is the zenika base.
- The real app boot (`node dist/main.js`, DB and Redis) and the HTTP PDF endpoints
  were not exercised in the container. The smoke test calls the services directly.
- The CI workflow change was not run on GitHub Actions. No push or remote is
  available.
