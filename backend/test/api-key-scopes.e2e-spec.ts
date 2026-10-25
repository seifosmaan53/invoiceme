/**
 * API-key permissions on every invoice route, and on clients bulk-archive.
 *
 * Real AppModule, PostgreSQL, ApiKeyOrJwtGuard + PermissionGuard. PdfService,
 * S3, email and notifications are stubs (test/e2e-app.ts).
 *
 * For each route:
 * - a key without the route's permission gets 403 with PermissionGuard's own
 *   message, and nothing changes (rows counted, email/upload mocks unused);
 * - a key with exactly that permission succeeds (positive control);
 * - a JWT login of the same owner succeeds (positive control: JWT sessions
 *   are not scoped).
 * The same request is valid in every case, so a 403 can only come from the
 * permission check. Removing a route's @RequirePermission makes its denial
 * test fail (recorded in docs/security/2026-10-25-pdf-keys-login.md).
 */
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus, InvoiceType } from '../src/entities/invoice.entity';
import { Attachment } from '../src/entities/attachment.entity';
import { ApiKeysService } from '../src/api-keys/api-keys.service';
import { createE2eApp, E2eApp, mockEmailService, mockPdfService, mockS3Service } from './e2e-app';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

type Auth = { header: string; value: string };

describe('API-key permissions on invoice and client routes (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let attachments: Repository<Attachment>;
  let apiKeys: ApiKeysService;

  let ownerId: string;
  let jwt: Auth;
  let client: Client;
  let invoice: Invoice;
  let estimate: Invoice;
  const keys: Record<string, Auth> = {};

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    attachments = e2e.moduleFixture.get(getRepositoryToken(Attachment));
    apiKeys = e2e.moduleFixture.get(ApiKeysService);
  });
  afterAll(async () => {
    await e2e.app.close();
  });

  beforeEach(async () => {
    await e2e.truncateAll();
    jest.clearAllMocks();
    const { user, token } = await e2e.createUser('scopes-owner@example.test');
    ownerId = user.id;
    jwt = { header: 'Authorization', value: `Bearer ${token}` };
    for (const [name, perms] of Object.entries({
      readOnly: ['read:invoices', 'read:clients', 'read:dashboard'],
      write: ['write:invoices'],
      read: ['read:invoices'],
      deleteInvoices: ['delete:invoices'],
      writeClients: ['write:clients'],
      deleteClients: ['delete:clients'],
    })) {
      const { key } = await apiKeys.generateApiKey(ownerId, name, perms);
      keys[name] = { header: 'X-API-Key', value: key };
    }
    client = await clients.save(clients.create({ userId: ownerId, name: 'Scope Client', email: 'scope-client@example.test' }));
    invoice = await makeInvoice('INV-SCOPE-1', InvoiceType.INVOICE);
    estimate = await makeInvoice('EST-SCOPE-1', InvoiceType.ESTIMATE);
  });

  function makeInvoice(number: string, type: InvoiceType) {
    return invoices.save(
      invoices.create({
        userId: ownerId,
        clientId: client.id,
        type,
        number,
        issueDate: new Date(),
        dueDate: new Date(),
        status: InvoiceStatus.SENT,
        currency: 'USD',
        subtotal: 100,
        taxTotal: 0,
        discountTotal: 0,
        total: 100,
      } as Partial<Invoice>),
    );
  }

  const http = () => request(e2e.app.getHttpServer());
  const liveInvoices = () => invoices.count({ where: { userId: ownerId } });
  const archivedInvoices = () => invoices.count({ where: { userId: ownerId, deletedAt: Not(IsNull()) }, withDeleted: true });

  function expectPermissionDenied(res: request.Response, permission: string) {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(`API key does not have required permission: ${permission}`);
  }

  interface RouteCase {
    name: string;
    permission: string;
    /** a key lacking `permission` (but otherwise valid for this owner) */
    deniedKey: string;
    /** a key with exactly `permission` */
    allowedKey: string;
    call: (auth: Auth) => request.Test;
    ok: number;
    /** observable effect: returns a value that must not change on denial */
    effect: () => Promise<unknown>;
  }

  const cases: RouteCase[] = [
    {
      name: 'POST /invoices/:id/duplicate',
      permission: 'write:invoices', deniedKey: 'readOnly', allowedKey: 'write', ok: 201,
      call: (a) => http().post(`/api/v1/invoices/${invoice.id}/duplicate`).set(a.header, a.value),
      effect: liveInvoices,
    },
    {
      name: 'POST /invoices/:id/convert',
      permission: 'write:invoices', deniedKey: 'readOnly', allowedKey: 'write', ok: 201,
      call: (a) => http().post(`/api/v1/invoices/${estimate.id}/convert`).set(a.header, a.value),
      effect: liveInvoices,
    },
    {
      name: 'POST /invoices/:id/send',
      permission: 'write:invoices', deniedKey: 'readOnly', allowedKey: 'write', ok: 201,
      call: (a) => http().post(`/api/v1/invoices/${invoice.id}/send`).set(a.header, a.value),
      effect: async () => [mockEmailService.sendInvoiceEmail.mock.calls.length, mockPdfService.generateInvoicePdf.mock.calls.length],
    },
    {
      name: 'POST /invoices/:id/attachments',
      permission: 'write:invoices', deniedKey: 'readOnly', allowedKey: 'write', ok: 201,
      call: (a) =>
        http().post(`/api/v1/invoices/${invoice.id}/attachments`).set(a.header, a.value)
          .attach('file', PNG, { filename: 'scan.png', contentType: 'image/png' }),
      effect: async () => [await attachments.count(), mockS3Service.uploadFile.mock.calls.length],
    },
    {
      name: 'POST /invoices/import/csv',
      permission: 'write:invoices', deniedKey: 'readOnly', allowedKey: 'write', ok: 201,
      call: (a) =>
        http().post('/api/v1/invoices/import/csv').set(a.header, a.value)
          .attach('file', Buffer.from(`clientId,items,issueDate,currency\n${client.id},Imported item|1|10,2026-01-01,USD\n`), {
            filename: 'invoices.csv', contentType: 'text/csv',
          }),
      effect: liveInvoices,
    },
    {
      name: 'POST /invoices/bulk-archive',
      permission: 'delete:invoices', deniedKey: 'write', allowedKey: 'deleteInvoices', ok: 201,
      call: (a) => http().post('/api/v1/invoices/bulk-archive').set(a.header, a.value).send({ ids: [invoice.id] }),
      effect: archivedInvoices,
    },
    {
      name: 'POST /invoices/:id/pdf',
      // POST default status; the PDF is sent directly (S3 stub unavailable)
      permission: 'read:invoices', deniedKey: 'writeClients', allowedKey: 'read', ok: 201,
      call: (a) => http().post(`/api/v1/invoices/${invoice.id}/pdf`).set(a.header, a.value),
      effect: async () => mockPdfService.generateInvoicePdf.mock.calls.length,
    },
    {
      name: 'GET /invoices/:id/attachments',
      permission: 'read:invoices', deniedKey: 'writeClients', allowedKey: 'read', ok: 200,
      call: (a) => http().get(`/api/v1/invoices/${invoice.id}/attachments`).set(a.header, a.value),
      effect: async () => 0,
    },
    {
      name: 'GET /invoices/export/csv',
      permission: 'read:invoices', deniedKey: 'writeClients', allowedKey: 'read', ok: 200,
      call: (a) => http().get('/api/v1/invoices/export/csv').set(a.header, a.value),
      effect: async () => 0,
    },
    {
      name: 'POST /clients/bulk-archive',
      permission: 'delete:clients', deniedKey: 'writeClients', allowedKey: 'deleteClients', ok: 201,
      call: (a) => http().post('/api/v1/clients/bulk-archive').set(a.header, a.value).send({ ids: [client.id] }),
      effect: () => clients.count({ where: { userId: ownerId } }),
    },
  ];

  describe.each(cases)('$name', (c) => {
    it(`a key without ${c.permission} is refused by the permission check and changes nothing`, async () => {
      const before = await c.effect();
      const res = await c.call(keys[c.deniedKey]);
      expectPermissionDenied(res, c.permission);
      expect(await c.effect()).toEqual(before);
    });

    it(`positive control: a key with ${c.permission} succeeds`, async () => {
      const res = await c.call(keys[c.allowedKey]);
      expect(res.status).toBe(c.ok);
    });

    it('positive control: the owner\'s JWT login succeeds', async () => {
      const res = await c.call(jwt);
      expect(res.status).toBe(c.ok);
    });
  });

  it('a read-only key can still read invoices and clients (positive control for the key itself)', async () => {
    const ro = keys.readOnly;
    await http().get('/api/v1/invoices').set(ro.header, ro.value).expect(200);
    await http().get(`/api/v1/invoices/${invoice.id}`).set(ro.header, ro.value).expect(200);
    await http().get(`/api/v1/invoices/${invoice.id}/attachments`).set(ro.header, ro.value).expect(200);
    await http().post(`/api/v1/invoices/${invoice.id}/pdf`).set(ro.header, ro.value).expect(201).expect('Content-Type', /pdf/);
    await http().get('/api/v1/invoices/export/csv').set(ro.header, ro.value).expect(200);
    await http().get('/api/v1/invoices/stats').set(ro.header, ro.value).expect(200);
    await http().get('/api/v1/clients').set(ro.header, ro.value).expect(200);
    await http().get('/api/v1/clients/export/csv').set(ro.header, ro.value).expect(200);
  });

  it('an unrestricted legacy key (no permissions) keeps full access', async () => {
    const { key } = await apiKeys.generateApiKey(ownerId, 'legacy', []);
    await http().post(`/api/v1/invoices/${invoice.id}/duplicate`).set('X-API-Key', key).expect(201);
    await http().post('/api/v1/invoices/bulk-archive').set('X-API-Key', key).send({ ids: [invoice.id] }).expect(201);
  });
});
