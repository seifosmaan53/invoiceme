/**
 * API keys fail closed.
 *
 * Real AppModule, PostgreSQL, ApiKeyOrJwtGuard + PermissionGuard
 * (test/e2e-app.ts). Covers:
 * - a route that accepts API keys but names no permission: keys are refused,
 *   JWT is not (a probe controller mounted only in this suite, because every
 *   real key-accepting route now names its permission);
 * - routes that never accept API keys (JWT-only controllers);
 * - a key with no permissions (as stored by older versions) has no access;
 *   '*' is the explicit full-access grant;
 * - insufficient and sufficient scopes, and another owner's records;
 * - creating a key without permissions is refused.
 * Every denial is paired with a positive control on the same route, so a
 * refusal cannot come from an unrelated guard or validation.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus, InvoiceType } from '../src/entities/invoice.entity';
import { ApiKeysService } from '../src/api-keys/api-keys.service';
import { ApiKeysModule } from '../src/api-keys/api-keys.module';
import { ApiKeyOrJwtGuard } from '../src/auth/guards/api-key-or-jwt.guard';
import { PermissionGuard } from '../src/auth/guards/permission.guard';
import { RequirePermission } from '../src/auth/decorators/require-permission.decorator';
import { createE2eApp, E2eApp } from './e2e-app';

@Controller('v1/test-probe')
@UseGuards(ApiKeyOrJwtGuard, PermissionGuard)
class ProbeController {
  @Get('unspecified')
  unspecified() {
    return { ok: true };
  }

  @Get('specified')
  @RequirePermission('read:invoices')
  specified() {
    return { ok: true };
  }
}

describe('API keys fail closed (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let apiKeys: ApiKeysService;

  let ownerId: string;
  let ownerJwt: string;
  let otherJwt: string;
  let ownInvoice: Invoice;
  let otherInvoice: Invoice;
  const key: Record<string, string> = {};

  beforeAll(async () => {
    e2e = await createE2eApp({ controllers: [ProbeController], imports: [ApiKeysModule] });
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    apiKeys = e2e.moduleFixture.get(ApiKeysService);
  });
  afterAll(async () => {
    await e2e.app.close();
  });

  async function makeInvoice(userId: string, number: string) {
    const client = await clients.save(clients.create({ userId, name: `Client ${number}` }));
    return invoices.save(
      invoices.create({
        userId,
        clientId: client.id,
        type: InvoiceType.INVOICE,
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

  beforeEach(async () => {
    await e2e.truncateAll();
    const owner = await e2e.createUser('fail-closed-owner@example.test');
    const other = await e2e.createUser('fail-closed-other@example.test');
    ownerId = owner.user.id;
    ownerJwt = `Bearer ${owner.token}`;
    otherJwt = `Bearer ${other.token}`;
    ownInvoice = await makeInvoice(ownerId, 'FC-OWN-1');
    otherInvoice = await makeInvoice(other.user.id, 'FC-OTHER-1');
    for (const [name, perms] of Object.entries({
      full: ['*'],
      read: ['read:invoices'],
      empty: [] as string[],
    })) {
      key[name] = (await apiKeys.generateApiKey(ownerId, name, perms)).key;
    }
  });

  const http = () => request(e2e.app.getHttpServer());

  describe('a key-accepting route that names no permission', () => {
    it('refuses every API key, including full access', async () => {
      for (const k of [key.full, key.read]) {
        const res = await http().get('/api/v1/test-probe/unspecified').set('X-API-Key', k);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('API keys are not accepted on this route');
      }
      // The Bearer form of a key is treated the same way
      await http().get('/api/v1/test-probe/unspecified').set('Authorization', `Bearer ${key.full}`).expect(403);
    });

    it('positive controls: JWT reaches it, and a key reaches the sibling route that names its permission', async () => {
      await http().get('/api/v1/test-probe/unspecified').set('Authorization', ownerJwt).expect(200, { ok: true });
      await http().get('/api/v1/test-probe/specified').set('X-API-Key', key.read).expect(200, { ok: true });
      await http().get('/api/v1/test-probe/specified').set('X-API-Key', key.full).expect(200, { ok: true });
    });
  });

  describe('routes that never accept API keys', () => {
    it.each(['/api/v1/user-settings', '/api/v1/sync/pull', '/api/v1/api-keys'])('%s refuses a full-access key; JWT works', async (path) => {
      await http().get(path).set('X-API-Key', key.full).expect(401);
      await http().get(path).set('Authorization', `Bearer ${key.full}`).expect(401);
      await http().get(path).set('Authorization', ownerJwt).expect(200);
    });
  });

  describe('a key with no permissions', () => {
    it('has no access; the same requests succeed with read:invoices or *', async () => {
      const denied = await http().get('/api/v1/invoices').set('X-API-Key', key.empty);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe('API key does not have required permission: read:invoices');
      await http().get(`/api/v1/invoices/${ownInvoice.id}`).set('X-API-Key', key.empty).expect(403);
      await http().post(`/api/v1/invoices/${ownInvoice.id}/duplicate`).set('X-API-Key', key.empty).expect(403);
      expect(await invoices.count({ where: { userId: ownerId } })).toBe(1);

      await http().get('/api/v1/invoices').set('X-API-Key', key.read).expect(200);
      await http().get(`/api/v1/invoices/${ownInvoice.id}`).set('X-API-Key', key.read).expect(200);
      await http().post(`/api/v1/invoices/${ownInvoice.id}/duplicate`).set('X-API-Key', key.full).expect(201);
      expect(await invoices.count({ where: { userId: ownerId } })).toBe(2);
    });
  });

  describe('scopes and ownership', () => {
    it('an insufficient scope is refused and changes nothing; a sufficient one works', async () => {
      const denied = await http().post(`/api/v1/invoices/${ownInvoice.id}/duplicate`).set('X-API-Key', key.read);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe('API key does not have required permission: write:invoices');
      expect(await invoices.count({ where: { userId: ownerId } })).toBe(1);
      await http().post(`/api/v1/invoices/${ownInvoice.id}/duplicate`).set('X-API-Key', key.full).expect(201);
    });

    it("a full-access key cannot read or change another owner's invoice; that owner can", async () => {
      await http().get(`/api/v1/invoices/${otherInvoice.id}`).set('X-API-Key', key.full).expect(404);
      await http().post(`/api/v1/invoices/${otherInvoice.id}/duplicate`).set('X-API-Key', key.full).expect(404);
      expect(await invoices.count({ where: { userId: otherInvoice.userId } })).toBe(1);
      await http().get(`/api/v1/invoices/${otherInvoice.id}`).set('Authorization', otherJwt).expect(200);
      await http().get(`/api/v1/invoices/${ownInvoice.id}`).set('X-API-Key', key.full).expect(200);
    });
  });

  describe('creating keys', () => {
    it.each([
      ['no permissions field', { name: 'none' }],
      ['an empty list', { name: 'empty', permissions: [] }],
      ['a blank entry', { name: 'blank', permissions: [' '] }],
    ])('refuses %s', async (_label, body) => {
      const res = await http().post('/api/v1/api-keys').set('Authorization', ownerJwt).send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Choose at least one permission; '*' grants full access");
    });

    it('positive control: a key created with a permission works for that permission only', async () => {
      const res = await http()
        .post('/api/v1/api-keys')
        .set('Authorization', ownerJwt)
        .send({ name: 'reader', permissions: ['read:invoices'] })
        .expect(201);
      await http().get('/api/v1/invoices').set('X-API-Key', res.body.key).expect(200);
      await http().post(`/api/v1/invoices/${ownInvoice.id}/duplicate`).set('X-API-Key', res.body.key).expect(403);
    });
  });
});
