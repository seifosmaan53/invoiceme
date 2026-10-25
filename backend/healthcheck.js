#!/usr/bin/env node
/**
 * Strict health check for the InvoiceMe backend.
 *
 *   node healthcheck.js [url]
 *
 * Default URL: http://127.0.0.1:${API_PORT:-3000}/api/v1/health (or HEALTHCHECK_URL).
 * Healthy ONLY when the response is exactly HTTP 200 (redirects are not
 * followed and count as failure) and the JSON body has status "ok" and
 * database "connected". Exit 0 = healthy, 1 = not healthy. Times out after
 * HEALTHCHECK_TIMEOUT_MS (default 5000).
 *
 * In production the backend serves this route over plain HTTP only to
 * loopback clients, so run the check on the same machine / inside the
 * container. It sends no forwarded-protocol header.
 */
'use strict';

const url =
  process.argv[2] ||
  process.env.HEALTHCHECK_URL ||
  `http://127.0.0.1:${process.env.API_PORT || 3000}/api/v1/health`;
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 5000);

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
    if (res.status !== 200) {
      return fail(`HTTP ${res.status}${res.headers.get('location') ? ` -> ${res.headers.get('location')}` : ''}`);
    }
    let body;
    try {
      body = JSON.parse(await res.text());
    } catch {
      return fail('response is not JSON');
    }
    if (body.status !== 'ok') return fail(`status is ${JSON.stringify(body.status)}`);
    if (body.database !== 'connected') return fail(`database is ${JSON.stringify(body.database)}`);
    console.log(`healthy: ${url}`);
    return 0;
  } catch (error) {
    return fail(controller.signal.aborted ? `no response within ${timeoutMs} ms` : String(error && error.message || error));
  } finally {
    clearTimeout(timer);
  }
}

function fail(reason) {
  console.error(`unhealthy: ${url}: ${reason}`);
  return 1;
}

main().then((code) => process.exit(code));
