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
});
