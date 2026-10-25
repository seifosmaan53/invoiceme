/**
 * pdfLogoUrl / pdfFontFamily input rules on PATCH /api/v1/user-settings
 * (real PostgreSQL, real JWT guard, production ValidationPipe).
 * See docs/security/2026-10-25-pdf-keys-login.md.
 */
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSettings } from '../src/entities/user-settings.entity';
import { createE2eApp, E2eApp } from './e2e-app';

describe('User settings: PDF logo URL and font input (E2E)', () => {
  let e2e: E2eApp;
  let settings: Repository<UserSettings>;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    settings = e2e.moduleFixture.get(getRepositoryToken(UserSettings));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    ({ token, user: { id: userId } } = await e2e.createUser('settings-owner@example.test'));
  });

  const patch = (body: Record<string, unknown>) =>
    request(e2e.app.getHttpServer()).patch('/api/v1/user-settings').set('Authorization', `Bearer ${token}`).send(body);

  it('positive control: accepts an https logo URL, and removes it with null or ""', async () => {
    const res = await patch({ pdfLogoUrl: 'https://cdn.example.com/logo.png' }).expect(200);
    expect(res.body.pdfLogoUrl).toBe('https://cdn.example.com/logo.png');
    expect((await settings.findOneBy({ userId }))!.pdfLogoUrl).toBe('https://cdn.example.com/logo.png');
    await patch({ pdfLogoUrl: null }).expect(200);
    expect((await settings.findOneBy({ userId }))!.pdfLogoUrl).toBeNull();
    await patch({ pdfLogoUrl: 'https://cdn.example.com/logo.png' }).expect(200);
    await patch({ pdfLogoUrl: '' }).expect(200);
    expect((await settings.findOneBy({ userId }))!.pdfLogoUrl).toBeNull();
  });

  it.each([
    ['http', 'http://cdn.example.com/logo.png', 'https://'],
    ['loopback over http', 'http://127.0.0.1:8080/logo.png', 'https://'],
    ['javascript:', 'javascript:alert(1)', 'https://'],
    ['file:', 'file:///etc/passwd', 'https://'],
    ['data:', 'data:image/png;base64,AAAA', 'https://'],
    ['credentials', 'https://user:pw@cdn.example.com/logo.png', 'credentials'],
    ['non-default port', 'https://cdn.example.com:8443/logo.png', 'default https port'],
    ['malformed', 'https://exa mple.com/logo.png', 'whitespace'],
  ])('rejects %s, leaving the stored value unchanged', async (_label, value, message) => {
    await patch({ pdfLogoUrl: 'https://cdn.example.com/ok.png' }).expect(200);
    const res = await patch({ pdfLogoUrl: value }).expect(400);
    expect(JSON.stringify(res.body.message)).toContain(message);
    expect((await settings.findOneBy({ userId }))!.pdfLogoUrl).toBe('https://cdn.example.com/ok.png');
  });

  it('a historical invalid value sent back unchanged does not block saving other settings, and is not rewritten', async () => {
    await patch({ pdfPrimaryColor: '#123456' }).expect(200);
    await settings.update({ userId }, { pdfLogoUrl: 'http://169.254.169.254/latest/meta-data/' });

    // The app sends the whole settings object back on every save
    const res = await patch({ pdfLogoUrl: 'http://169.254.169.254/latest/meta-data/', pdfPrimaryColor: '#654321' }).expect(200);
    expect(res.body.pdfPrimaryColor).toBe('#654321');
    expect((await settings.findOneBy({ userId }))!.pdfLogoUrl).toBe('http://169.254.169.254/latest/meta-data/');

    // ...but it cannot be changed to another invalid value
    await patch({ pdfLogoUrl: 'http://127.0.0.1/' }).expect(400);
  });

  it('rejects a font family that could carry CSS; accepts the app\'s fonts', async () => {
    for (const font of ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana']) {
      await patch({ pdfFontFamily: font }).expect(200);
    }
    await patch({ pdfFontFamily: 'x}body{background:url(http://127.0.0.1/f)}' }).expect(400);
    expect((await settings.findOneBy({ userId }))!.pdfFontFamily).toBe('Verdana');
  });
});
