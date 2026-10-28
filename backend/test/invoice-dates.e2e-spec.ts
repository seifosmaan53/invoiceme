/**
 * Issue and due dates are calendar dates: what the client sends is what is
 * stored and what the invoice number uses, whatever the server's timezone.
 *
 * new Date('2025-01-01') is UTC midnight, which is 2024-12-31 in local time
 * west of UTC; the old code stored that and numbered the invoice INV-2024-.
 * The bug only shows when the process runs west of UTC, so CI also runs this
 * file with TZ=America/New_York (ci.yml). In UTC it still checks the values.
 *
 * Real AppModule and PostgreSQL (test/e2e-app.ts); dates are read back with
 * SQL so no JS Date conversion sits between the database and the assertion.
 */
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Invoice calendar dates (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let auth: string;
  let clientId: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
  });
  afterAll(async () => {
    await e2e.app.close();
  });

  beforeEach(async () => {
    await e2e.truncateAll();
    const { user, token } = await e2e.createUser('dates-owner@example.test');
    auth = `Bearer ${token}`;
    clientId = (await clients.save(clients.create({ userId: user.id, name: 'Dates Client' }))).id;
  });

  const http = () => request(e2e.app.getHttpServer());
  const stored = async (id: string) =>
    (
      await e2e.dataSource.query(
        `SELECT to_char(issue_date, 'YYYY-MM-DD') AS issue, to_char(due_date, 'YYYY-MM-DD') AS due, number FROM invoices WHERE id = $1`,
        [id],
      )
    )[0] as { issue: string; due: string | null; number: string };

  async function create(issueDate: string, dueDate?: string) {
    const res = await http()
      .post('/api/v1/invoices')
      .set('Authorization', auth)
      .send({ clientId, issueDate, dueDate, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })
      .expect(201);
    return res.body.id as string;
  }

  it(`stores the dates as sent and numbers by that year (process TZ: ${process.env.TZ || 'unset'})`, async () => {
    const id = await create('2025-01-01', '2025-01-31');
    const row = await stored(id);
    expect(row.issue).toBe('2025-01-01');
    expect(row.due).toBe('2025-01-31');
    expect(row.number).toMatch(/^INV-2025-/);
  });

  it('keeps the written date of a full timestamp', async () => {
    const id = await create('2025-11-23T00:00:00Z', '2025-12-23T00:00:00Z');
    const row = await stored(id);
    expect(row.issue).toBe('2025-11-23');
    expect(row.due).toBe('2025-12-23');
  });

  it('update and duplicate keep calendar dates', async () => {
    const id = await create('2025-03-01', '2025-03-31');
    await http().patch(`/api/v1/invoices/${id}`).set('Authorization', auth).send({ issueDate: '2025-04-01', dueDate: '2025-05-01' }).expect(200);
    expect(await stored(id)).toMatchObject({ issue: '2025-04-01', due: '2025-05-01' });

    const copy = await http().post(`/api/v1/invoices/${id}/duplicate`).set('Authorization', auth).expect(201);
    expect((await stored(copy.body.id)).due).toBe('2025-05-01');
  });

  it('restarts the sequence in a new calendar year, not a shifted one', async () => {
    const first = await stored(await create('2025-12-31'));
    const second = await stored(await create('2026-01-01'));
    expect(first.number).toBe('INV-2025-0001');
    expect(second.number).toBe('INV-2026-0001');
  });
});
