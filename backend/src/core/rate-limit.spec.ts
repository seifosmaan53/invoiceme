import * as express from 'express';
import * as request from 'supertest';
import { applyTrustedProxyPolicy, trustProxySetting } from './https-enforcement';
import { createRateLimiters } from './rate-limit';

/** /api limited to 2 requests per window, wired like main.ts. */
function limitedApp(trustProxyEnv: string | undefined) {
  const app = express();
  applyTrustedProxyPolicy(app, trustProxySetting(trustProxyEnv));
  app.use('/api', createRateLimiters({ nodeEnv: 'production', max: 2 }).api);
  app.get('/api/ping', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('rate-limit identity', () => {
  it('a direct client cannot get a fresh key by rotating X-Forwarded-For (TRUST_PROXY unset)', async () => {
    const app = limitedApp(undefined);
    await request(app).get('/api/ping').set('X-Forwarded-For', '1.1.1.1').expect(200);
    await request(app).get('/api/ping').set('X-Forwarded-For', '2.2.2.2').expect(200);
    await request(app).get('/api/ping').set('X-Forwarded-For', '3.3.3.3').expect(429);
  });

  it('a peer that is not the named proxy cannot rotate X-Forwarded-For either', async () => {
    const app = limitedApp('10.255.0.1');
    await request(app).get('/api/ping').set('X-Forwarded-For', '1.1.1.1').expect(200);
    await request(app).get('/api/ping').set('X-Forwarded-For', '2.2.2.2').expect(200);
    await request(app).get('/api/ping').set('X-Forwarded-For', '3.3.3.3').expect(429);
  });

  it('behind a trusted proxy, prepending entries does not change the key', async () => {
    const app = limitedApp('true');
    // the proxy appends the real address; the client controls everything to its left
    for (const [spoof, status] of [['1.1.1.1', 200], ['127.0.0.1', 200], ['3.3.3.3', 429]] as const) {
      const res = await request(app).get('/api/ping').set('X-Forwarded-For', `${spoof}, 198.51.100.7`).expect(status);
      if (status === 200) expect(res.body.ip).toBe('198.51.100.7');
    }
  });

  it('positive control: behind a trusted proxy, different clients get separate buckets', async () => {
    const app = limitedApp('true');
    for (let i = 0; i < 2; i++) await request(app).get('/api/ping').set('X-Forwarded-For', '198.51.100.7').expect(200);
    await request(app).get('/api/ping').set('X-Forwarded-For', '198.51.100.7').expect(429);
    const res = await request(app).get('/api/ping').set('X-Forwarded-For', '198.51.100.8').expect(200);
    expect(res.body.ip).toBe('198.51.100.8');
  });
});
