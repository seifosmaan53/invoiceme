/**
 * Puppeteer configuration (read by `npm ci`/`npm install` and at runtime).
 *
 * Never download Puppeteer's own Chrome. The download is ~170 MB, its HTTP
 * client has no timeout (a slow host stalls `npm ci` indefinitely, see
 * docs/security/2026-10-25-container-pdf.md), and no supported layout uses it:
 * the container image uses Alpine's Chromium and update bundles use the
 * operating system's browser, both through PUPPETEER_EXECUTABLE_PATH.
 *
 * To render PDFs from a checkout, point PUPPETEER_EXECUTABLE_PATH at an
 * installed Chrome/Chromium; `node scripts/find-browser.js` prints one (see
 * docs/DEVELOPER_GUIDE.md). Setting PUPPETEER_SKIP_DOWNLOAD=false for one
 * install still downloads Puppeteer's Chrome into ~/.cache/puppeteer.
 */
module.exports = {
  skipDownload: true,
};
