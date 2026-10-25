/**
 * PDF rendering must not make network requests (server-side request forgery).
 *
 * These tests launch a real Chromium through the real PdfService and record
 * every TCP connection made to a local listener on 127.0.0.1. User-controlled
 * values (logo URL, font family, invoice number via sync) point at that
 * listener. A connection means the server's browser contacted a destination
 * chosen by the user.
 *
 * A browser is required. It is taken from PUPPETEER_EXECUTABLE_PATH or a few
 * well-known locations. Without one the suite is skipped with a warning
 * (CI installs with PUPPETEER_SKIP_DOWNLOAD; GitHub's ubuntu runners ship
 * /usr/bin/google-chrome).
 */
import * as fs from 'fs';
import * as net from 'net';
import { PdfService } from '../src/core/services/pdf.service';
import { PdfCacheService } from '../src/core/services/pdf-cache.service';
import * as pdfLogo from '../src/core/services/pdf-logo';
import { lockDownPage } from '../src/core/services/pdf-render-sandbox';
import * as puppeteer from 'puppeteer';

function findBrowser(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  try {
    for (const dir of fs.readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) candidates.push(`/opt/pw-browsers/${dir}/chrome-linux64/chrome`);
    }
  } catch {
    // not present
  }
  return candidates.find((p) => p && fs.existsSync(p));
}

const browserPath = findBrowser();
const describeWithBrowser = browserPath ? describe : describe.skip;
if (!browserPath) {
  // eslint-disable-next-line no-console
  console.warn('pdf-network.spec: no Chromium found, PDF network tests SKIPPED');
}

interface Listener {
  port: number;
  connections: number;
  requests: string[];
  close(): Promise<void>;
}

/** Plain TCP listener: counts connections and records HTTP request lines. */
async function startListener(): Promise<Listener> {
  const state = { connections: 0, requests: [] as string[] };
  const server = net.createServer((socket) => {
    state.connections++;
    socket.once('data', (chunk) => {
      state.requests.push(chunk.toString('latin1').split('\r\n')[0]);
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    get connections() {
      return state.connections;
    },
    get requests() {
      return state.requests;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function invoiceData(overrides: { number?: string; settings?: Record<string, unknown> } = {}) {
  return {
    invoice: {
      id: '00000000-0000-4000-8000-0000000000e1',
      number: overrides.number ?? 'PDFNET-0001',
      type: 'invoice',
      status: 'sent',
      currency: 'USD',
      issueDate: new Date('2026-01-15T00:00:00Z'),
      dueDate: new Date('2026-02-14T00:00:00Z'),
      subtotal: 100,
      taxTotal: 0,
      discountTotal: 0,
      total: 100,
      notes: 'Synthetic invoice for the PDF network test.',
    },
    client: { id: '00000000-0000-4000-8000-0000000000e2', name: 'Synthetic Client', email: 'client@example.invalid' },
    items: [{ description: 'Synthetic item', quantity: 1, unitPrice: 100, taxRate: 0, discountRate: 0, lineTotal: 100 }],
    user: { companyName: 'Synthetic Co' },
    settings: overrides.settings ?? {},
  };
}

const ONE_PIXEL_IMAGE = /\/Width 1[^0-9]/;

function expectPdf(buffer: Buffer) {
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
}

describeWithBrowser('PDF rendering makes no network requests (real Chromium)', () => {
  jest.setTimeout(60000);
  let listener: Listener;
  let service: PdfService;
  const savedPath = process.env.PUPPETEER_EXECUTABLE_PATH;

  beforeAll(() => {
    process.env.PUPPETEER_EXECUTABLE_PATH = browserPath;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    service = new PdfService();
  });
  afterAll(() => {
    process.env.PUPPETEER_EXECUTABLE_PATH = savedPath;
    jest.restoreAllMocks();
  });
  beforeEach(async () => {
    listener = await startListener();
  });
  afterEach(async () => {
    await listener.close();
  });

  it('does not request a user-supplied logo URL on a loopback address', async () => {
    const pdf = await service.generateInvoicePdf(
      invoiceData({ settings: { logoUrl: `http://127.0.0.1:${listener.port}/logo.png`, showLogo: true } }),
    );
    expectPdf(pdf);
    expect(listener.requests).toEqual([]);
    expect(listener.connections).toBe(0);
  });

  it('does not request a URL injected through the font family', async () => {
    const pdf = await service.generateInvoicePdf(
      invoiceData({ settings: { fontFamily: `x}body{background:url(http://127.0.0.1:${listener.port}/f)}` } }),
    );
    expectPdf(pdf);
    expect(listener.requests).toEqual([]);
    expect(listener.connections).toBe(0);
  });

  it('does not request markup injected through the invoice number (settable through sync)', async () => {
    const pdf = await service.generateInvoicePdf(
      invoiceData({ number: `<img src="http://127.0.0.1:${listener.port}/n.png">` }),
    );
    expectPdf(pdf);
    expect(listener.requests).toEqual([]);
    expect(listener.connections).toBe(0);
  });

  it('positive control: a logo the server fetched is in the PDF, still without browser requests', async () => {
    // 1x1 PNG; the fetch itself is covered by pdf-logo.spec.ts
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const fetchSpy = jest.spyOn(pdfLogo, 'fetchLogoAsDataUri').mockResolvedValue(`data:image/png;base64,${png}`);
    try {
      const withLogo = await service.generateInvoicePdf(
        invoiceData({ settings: { logoUrl: 'https://cdn.example.com/logo.png', showLogo: true } }),
      );
      const without = await service.generateInvoicePdf(invoiceData());
      expectPdf(withLogo);
      expect(fetchSpy).toHaveBeenCalledWith('https://cdn.example.com/logo.png');
      // the template's gradients are images too: look for the 1x1 logo
      expect(withLogo.toString('latin1')).toMatch(ONE_PIXEL_IMAGE);
      expect(without.toString('latin1')).not.toMatch(ONE_PIXEL_IMAGE);
      expect(listener.connections).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('renders without the logo when the server-side fetch fails', async () => {
    const fetchSpy = jest.spyOn(pdfLogo, 'fetchLogoAsDataUri').mockRejectedValue(new pdfLogo.LogoFetchError('refused'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const pdf = await service.generateInvoicePdf(
        invoiceData({ settings: { logoUrl: 'https://cdn.example.com/logo.png', showLogo: true } }),
      );
      expectPdf(pdf);
      expect(pdf.toString('latin1')).not.toMatch(ONE_PIXEL_IMAGE);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('never hands a historical non-https logo URL to the fetcher', async () => {
    const fetchSpy = jest.spyOn(pdfLogo, 'fetchLogoAsDataUri');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const logoUrl of [`http://127.0.0.1:${listener.port}/l.png`, 'javascript:alert(1)', 'file:///etc/passwd', 'data:image/svg+xml,<svg/>']) {
        expectPdf(await service.generateInvoicePdf(invoiceData({ settings: { logoUrl, showLogo: true } })));
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(listener.connections).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  describe('browser layers on raw hostile HTML (no template escaping)', () => {
    let cache: PdfCacheService;
    beforeAll(() => {
      cache = new PdfCacheService({ get: async () => null, set: async () => undefined } as any);
    });
    afterAll(async () => {
      await cache.closeBrowser();
    });

    // Subresources Chromium's request interception sees
    function interceptedKinds(u: string) {
      return `<link rel="stylesheet" href="${u}/css">
        <style>@font-face{font-family:X;src:url(${u}/font)} body{font-family:X;background:url(${u}/bg)}</style>
        <img src="${u}/img"><img srcset="${u}/srcset 2x"><video poster="${u}/poster"></video>
        <svg><image href="${u}/svgimage"/></svg>
        <script>fetch('${u}/fetch'); new WebSocket('${u.replace('http', 'ws')}/ws'); new Image().src='${u}/js';</script>`;
    }
    // Connections request interception does NOT see (measured, Chromium 1xx)
    function uninterceptedKinds(u: string) {
      return `<link rel="preconnect" href="${u}"><link rel="prefetch" href="${u}/prefetch">
        <iframe src="${u}/iframe"></iframe><object data="${u}/object"></object><embed src="${u}/embed">
        <meta http-equiv="refresh" content="0;url=${u}/refresh">`;
    }
    const page = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}<p>hostile page</p></body></html>`;
    const loopback = () => `http://127.0.0.1:${listener.port}`;

    async function render(p: any, html: string) {
      try {
        await p.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        await p.close();
      }
    }

    it('PdfCacheService.newPage() (both layers): no connection for any kind, PDF renders', async () => {
      const p = await cache.newPage();
      try {
        await p.setContent(page(interceptedKinds(loopback()) + uninterceptedKinds(loopback())), { waitUntil: 'networkidle0', timeout: 30000 });
        expectPdf(Buffer.from(await p.pdf({ format: 'A4' })));
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        await p.close();
      }
      expect(listener.requests).toEqual([]);
      expect(listener.connections).toBe(0);
    });

    it('browser flags alone (page without interception): no connection for any kind', async () => {
      await render(await (await cache.getBrowser()).newPage(), page(interceptedKinds(loopback()) + uninterceptedKinds(loopback())));
      expect(listener.connections).toBe(0);
    });

    it('browser flags: hostnames are not sent to a proxy configured in the environment', async () => {
      const saved = { ...process.env };
      Object.assign(process.env, { http_proxy: loopback(), https_proxy: loopback(), HTTP_PROXY: loopback(), HTTPS_PROXY: loopback(), all_proxy: loopback() });
      const proxied = new PdfCacheService({ get: async () => null, set: async () => undefined } as any);
      try {
        const p = await (await proxied.getBrowser()).newPage();
        await render(p, page(interceptedKinds('http://example.invalid') + uninterceptedKinds('http://example.invalid')));
      } finally {
        await proxied.closeBrowser();
        for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy']) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
      }
      expect(listener.requests).toEqual([]);
      expect(listener.connections).toBe(0);
    });

    describe('plain browser (no PDF_BROWSER_ARGS)', () => {
      let plain: any;
      beforeAll(async () => {
        plain = await puppeteer.launch({
          headless: 'new',
          executablePath: browserPath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
      });
      afterAll(async () => {
        await plain.close();
      });

      it('control: the intercepted kinds connect when nothing blocks them', async () => {
        await render(await plain.newPage(), page(interceptedKinds(loopback())));
        expect(listener.requests.length).toBeGreaterThanOrEqual(3);
      });

      it('interception alone: lockDownPage() blocks the kinds it sees', async () => {
        const p = await plain.newPage();
        const blocked = await lockDownPage(p);
        await render(p, page(interceptedKinds(loopback())));
        expect(listener.connections).toBe(0);
        expect(blocked.length).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
