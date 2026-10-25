/**
 * Trusted-proxy policy, HTTPS enforcement, redirect target and rate-limit
 * identity on the real Nest application (AppModule + PostgreSQL), wired like
 * main.ts in production: applyHttpSecurity() then createRateLimiters().
 *
 * Peers are real sockets: 127.0.0.1 and, when the machine has one, a
 * non-loopback local IPv4 address (the server listens on both and the client
 * binds its source address), so "trusted proxy" vs "direct client" is decided
 * by the actual remoteAddress, not by a mock. Tests that need the second
 * address are skipped when there is none.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { User } from '../src/entities/user.entity';
import { applyHttpSecurity, HttpSecurityEnv } from '../src/core/https-enforcement';
import { createRateLimiters } from '../src/core/rate-limit';

const LAN = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const itLan = LAN ? it : it.skip;

const HTTPS_REQUIRED = {
  error: 'HTTPS required',
  message: 'This application requires HTTPS. Please use HTTPS to access the API.',
};

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

interface Running {
  app: INestApplication;
  servers: http.Server[];
  /** port per listening address */
  port: Record<string, number>;
}

async function start(env: Omit<HttpSecurityEnv, 'NODE_ENV'>): Promise<Running> {
  const moduleFixture = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test', '.env'] }), AppModule],
  })
    .overrideModule(TypeOrmModule)
    .useModule(
      TypeOrmModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: (c: ConfigService) => ({
          type: 'postgres',
          host: c.get('DB_TEST_HOST') || c.get('DB_HOST'),
          port: c.get('DB_TEST_PORT') || c.get('DB_PORT'),
          username: c.get('DB_TEST_USERNAME') || c.get('DB_USERNAME'),
          password: c.get('DB_TEST_PASSWORD') || c.get('DB_PASSWORD'),
          database: c.get('DB_TEST_DATABASE') || c.get('DB_DATABASE') + '_test',
          entities: [__dirname + '/../src/entities/**/*.entity.ts'],
          synchronize: false,
          logging: false,
        }),
        inject: [ConfigService],
      }),
    )
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  // main.ts order: trusted-proxy policy + HTTPS enforcement first, then rate limits.
  const expressApp = app.getHttpAdapter().getInstance();
  applyHttpSecurity(expressApp, { NODE_ENV: 'production', ...env });
  const limiters = createRateLimiters({ nodeEnv: 'production' });
  app.use('/api', limiters.api);
  app.use('/api/v1/auth/login', limiters.login);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.setGlobalPrefix('api');
  await app.init();

  const servers: http.Server[] = [];
  const port: Record<string, number> = {};
  for (const host of LAN ? ['127.0.0.1', LAN] : ['127.0.0.1']) {
    const server = http.createServer(expressApp);
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    servers.push(server);
    port[host] = (server.address() as AddressInfo).port;
  }
  return { app, servers, port };
}

async function stop(r: Running) {
  for (const s of r.servers) await new Promise((resolve) => s.close(resolve));
  await r.app.close();
}

/** One request from source address `from` to the server listening on `from`. */
function send(r: Running, from: string, method: string, url: string, headers: Record<string, string> = {}, body?: object): Promise<Res> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: from,
        port: r.port[from],
        localAddress: from,
        method,
        path: url,
        headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers },
        agent: false,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed: any = data;
          try {
            parsed = JSON.parse(data);
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function healthcheck(url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, '..', 'healthcheck.js'), url], (err, stdout, stderr) => {
      resolve({ code: err ? (err as any).code ?? 1 : 0, out: `${stdout}${stderr}` });
    });
  });
}

describe('Trusted-proxy policy / HTTPS enforcement (E2E, production wiring)', () => {
  const email = 'proxy-owner@example.test';
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    // one synthetic user, for the login positive control
    const r = await start({});
    const ds = r.app.get<Repository<User>>(getRepositoryToken(User)).manager.connection;
    await ds.query('TRUNCATE TABLE ' + ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE');
    await r.app.get<Repository<User>>(getRepositoryToken(User)).save({ email, passwordHash: await bcrypt.hash(password, 4), name: 'Proxy Owner' });
    await stop(r);
  });

  describe('no TRUST_PROXY, no redirect policy (default)', () => {
    let r: Running;
    beforeAll(async () => (r = await start({})));
    afterAll(async () => stop(r));

    it('healthcheck.js passes on loopback: real 200 with status ok and database connected', async () => {
      const res = await send(r, '127.0.0.1', 'GET', '/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
      const probe = await healthcheck(`http://127.0.0.1:${r.port['127.0.0.1']}/api/v1/health`);
      expect(probe).toMatchObject({ code: 0 });
    });

    itLan('a non-loopback client gets 403 on the health route, and healthcheck.js reports it unhealthy', async () => {
      const res = await send(r, LAN as string, 'GET', '/api/v1/health');
      expect(res.status).toBe(403);
      expect(res.body).toEqual(HTTPS_REQUIRED);
      const probe = await healthcheck(`http://${LAN}:${r.port[LAN as string]}/api/v1/health`);
      expect(probe.code).toBe(1);
      expect(probe.out).toMatch(/unhealthy: .*HTTP 403/);
    });

    it('a direct client cannot claim HTTPS with X-Forwarded-Proto', async () => {
      const res = await send(r, '127.0.0.1', 'POST', '/api/v1/auth/login', { 'x-forwarded-proto': 'https' }, { email, password });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(HTTPS_REQUIRED);
    });

    it('plain-HTTP GET with a malicious Host is refused without any Location', async () => {
      const res = await send(r, '127.0.0.1', 'GET', '/api/v1/clients', { host: 'evil.example' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(HTTPS_REQUIRED);
      expect(res.headers.location).toBeUndefined();
    });
  });

  describe('PUBLIC_ORIGIN set', () => {
    let r: Running;
    beforeAll(async () => (r = await start({ PUBLIC_ORIGIN: 'https://invoices.example.test' })));
    afterAll(async () => stop(r));

    it('redirects to the configured origin whatever the Host header says', async () => {
      for (const host of ['evil.example', 'invoices.example.test.evil.example']) {
        const res = await send(r, '127.0.0.1', 'GET', '/api/v1/clients?page=2', { host });
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('https://invoices.example.test/api/v1/clients?page=2');
      }
    });

    it('the health probe on loopback is still served, not redirected', async () => {
      const probe = await healthcheck(`http://127.0.0.1:${r.port['127.0.0.1']}/api/v1/health`);
      expect(probe.code).toBe(0);
    });

    it('rejects a malformed PUBLIC_ORIGIN at startup', async () => {
      await expect(start({ PUBLIC_ORIGIN: 'http://invoices.example.test' })).rejects.toThrow(/PUBLIC_ORIGIN/);
    });
  });

  describe('TRUSTED_HOSTS set', () => {
    let r: Running;
    beforeAll(async () => (r = await start({ TRUSTED_HOSTS: 'pos.local' })));
    afterAll(async () => stop(r));

    it('redirects only to an allowed Host', async () => {
      const ok = await send(r, '127.0.0.1', 'GET', '/api/v1/clients', { host: 'pos.local' });
      expect(ok.status).toBe(301);
      expect(ok.headers.location).toBe('https://pos.local/api/v1/clients');
      const bad = await send(r, '127.0.0.1', 'GET', '/api/v1/clients', { host: 'evil.example' });
      expect(bad.status).toBe(403);
      expect(bad.headers.location).toBeUndefined();
    });
  });

  describe('TRUST_PROXY names the LAN address: it is the proxy, 127.0.0.1 is a direct client', () => {
    let r: Running;
    beforeAll(async () => {
      if (LAN) r = await start({ TRUST_PROXY: LAN });
    });
    afterAll(async () => r && stop(r));

    itLan('positive control: the owner logs in through the trusted proxy', async () => {
      const res = await send(r, LAN as string, 'POST', '/api/v1/auth/login', { 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.7' }, { email, password });
      expect([200, 201]).toContain(res.status);
      expect(res.body.accessToken ?? res.body.access_token ?? res.body.tokens).toBeDefined();
    });

    itLan('the same request from an untrusted peer is refused by HTTPS enforcement', async () => {
      const res = await send(r, '127.0.0.1', 'POST', '/api/v1/auth/login', { 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.7' }, { email, password });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(HTTPS_REQUIRED);
    });

    itLan('multi-value X-Forwarded-Proto: the value the proxy appended decides', async () => {
      const spoofed = await send(r, LAN as string, 'POST', '/api/v1/auth/login', { 'x-forwarded-proto': 'https, http', 'x-forwarded-for': '198.51.100.7' }, { email, password });
      expect(spoofed.status).toBe(403);
      // passes HTTPS enforcement and reaches authentication (wrong password -> 401)
      const real = await send(r, LAN as string, 'POST', '/api/v1/auth/login', { 'x-forwarded-proto': 'http, https', 'x-forwarded-for': '198.51.100.7' }, { email, password: 'wrong-password' });
      expect(real.status).toBe(401);
    });

    itLan('login rate limit: rotating spoofed X-Forwarded-For entries keeps one key; another real client has its own', async () => {
      const attempt = (xff: string) =>
        send(r, LAN as string, 'POST', '/api/v1/auth/login', { 'x-forwarded-proto': 'https', 'x-forwarded-for': xff }, { email, password: 'wrong-password' });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await attempt(`10.9.9.${i}, 203.0.113.50`)).status);
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses[5]).toBe(429);
      // positive control: a different client behind the same proxy is not limited
      expect((await attempt('203.0.113.51')).status).toBe(401);
    });
  });
});
