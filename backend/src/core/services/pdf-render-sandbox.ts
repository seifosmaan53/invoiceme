import type { HTTPRequest, Page } from 'puppeteer';

/**
 * PDF pages are rendered from HTML that contains user data. The browser must
 * not reach the network while doing so: no fetches, no DNS, no preconnects.
 *
 * Layers (see docs/security/2026-10-25-pdf-keys-login.md):
 * 1. PDF_BROWSER_ARGS: the browser's host resolver maps every host, IP
 *    literals included, to NOTFOUND, and no proxy is used. This is the layer
 *    that matters: request interception alone does NOT see
 *    <link rel=prefetch> (a full GET), preconnect, or the connections opened
 *    for iframe/object/meta-refresh navigations.
 * 2. lockDownPage(): request interception aborts every request except data:
 *    and about:blank, and JavaScript is disabled (no WebSocket, WebRTC or
 *    fetch from script).
 * 3. PdfService escapes and constrains every value it puts into the template.
 *
 * Images that belong in the PDF (the logo) are fetched by the server with
 * explicit protections and inlined as data: URIs (pdf-logo.ts).
 */
export const PDF_BROWSER_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--no-proxy-server',
  '--dns-prefetch-disable',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-pings',
];

function isAllowedUrl(url: string): boolean {
  return url.startsWith('data:') || url === 'about:blank';
}

/** Returns the list of URLs the page tried to load (and was refused). */
export async function lockDownPage(page: Page): Promise<string[]> {
  const blockedUrls: string[] = [];
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    if (isAllowedUrl(url)) {
      void request.continue();
    } else {
      blockedUrls.push(url);
      void request.abort('blockedbyclient');
    }
  });
  return blockedUrls;
}
