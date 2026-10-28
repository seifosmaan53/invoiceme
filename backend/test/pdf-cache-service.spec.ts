/**
 * PdfCacheService hands out pages only through newPage(), which blocks
 * network requests and disables JavaScript (pdf-render-sandbox.ts). The
 * shared browser itself is private: a page opened directly on it would have
 * neither protection. No real browser is started here; pdf-network.spec.ts
 * measures the protections in Chromium.
 */
const fakePage = {
  setJavaScriptEnabled: jest.fn(async () => undefined),
  setRequestInterception: jest.fn(async () => undefined),
  on: jest.fn(),
};
const fakeBrowser = { newPage: jest.fn(async () => fakePage), close: jest.fn(async () => undefined) };
const launch = jest.fn(async () => fakeBrowser);
jest.mock('puppeteer', () => ({ launch: (...args: unknown[]) => launch(...(args as [])) }));

import { PdfCacheService } from '../src/core/services/pdf-cache.service';
import { PDF_BROWSER_ARGS } from '../src/core/services/pdf-render-sandbox';

describe('PdfCacheService', () => {
  const service = () => new PdfCacheService({ get: async () => null, set: async () => undefined } as any);

  beforeEach(() => jest.clearAllMocks());

  it('newPage() returns a page with JavaScript off and every request intercepted', async () => {
    const page = await service().newPage();
    expect(page).toBe(fakePage);
    expect(fakePage.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(fakePage.setRequestInterception).toHaveBeenCalledWith(true);
    expect(fakePage.on).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('launches the shared browser with the no-network flags, once', async () => {
    const s = service();
    await s.newPage();
    await s.newPage();
    expect(launch).toHaveBeenCalledTimes(1);
    expect((launch.mock.calls[0] as any)[0].args).toEqual(expect.arrayContaining(PDF_BROWSER_ARGS));
  });

  it('does not expose the browser', () => {
    const s = service();
    // @ts-expect-error getBrowser is private; pages come only from newPage()
    expect(typeof s.getBrowser).toBe('function');
  });
});
