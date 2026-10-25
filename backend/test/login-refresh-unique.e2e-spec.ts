/**
 * Two logins of the same user within one second used to issue the same
 * refresh token (JWT with only sub/iat/exp) and the second insert hit the
 * unique constraint on refresh_tokens.token: HTTP 500.
 *
 * Date.now is pinned so both logins are in the same second regardless of
 * machine speed. Real PostgreSQL, real AuthService and JWT signing.
 */
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Login: refresh tokens are unique per issue (E2E)', () => {
  let e2e: E2eApp;
  let refreshTokens: Repository<RefreshToken>;
  let userId: string;
  const email = 'twice@example.test';

  beforeAll(async () => {
    e2e = await createE2eApp();
    refreshTokens = e2e.moduleFixture.get(getRepositoryToken(RefreshToken));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    ({ user: { id: userId } } = await e2e.createUser(email)); // password123
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const http = () => request(e2e.app.getHttpServer());
  const login = () => http().post('/api/v1/auth/login').send({ email, password: 'password123' });
  const pinClock = () => {
    const now = Math.floor(Date.now() / 1000) * 1000 + 100;
    jest.spyOn(Date, 'now').mockReturnValue(now);
  };

  it('two logins in the same second both succeed with different refresh tokens', async () => {
    pinClock();
    const first = await login();
    const second = await login();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
    expect(await refreshTokens.countBy({ userId })).toBe(2);
  });

  it('concurrent logins in the same second all succeed', async () => {
    pinClock();
    const results = await Promise.all([login(), login(), login()]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.refreshToken)).size).toBe(3);
  });

  it('refresh semantics are unchanged: each token refreshes once, rotation, lifetime 7 days', async () => {
    pinClock();
    const a = (await login()).body.refreshToken;
    const b = (await login()).body.refreshToken;

    // the token is still a JWT for the user, signed with the refresh secret, 7d lifetime
    const decoded = e2e.moduleFixture.get(JwtService).verify(a, {
      secret: e2e.moduleFixture.get(ConfigService).get('JWT_REFRESH_SECRET'),
    });
    expect(decoded.sub).toBe(userId);
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 3600);
    const stored = await refreshTokens.findOneByOrFail({ token: a });
    expect(Math.round((stored.expiresAt.getTime() - Date.now()) / 86400000)).toBe(7);

    // refresh in the same second as the logins
    const refreshedA = await http().post('/api/v1/auth/refresh').send({ refreshToken: a }).expect(200);
    expect(refreshedA.body.refreshToken).not.toBe(a);
    expect(refreshedA.body.refreshToken).not.toBe(b);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: a }).expect(401); // used up
    await http().post('/api/v1/auth/refresh').send({ refreshToken: b }).expect(200); // other session unaffected
    await http().post('/api/v1/auth/refresh').send({ refreshToken: refreshedA.body.refreshToken }).expect(200);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-token' }).expect(401);
  });
});
