import { INestApplication } from '@nestjs/common';

/**
 * Initialise the app and keep it listening on one loopback port for the
 * whole spec. Given a server that is not listening, supertest opens and
 * closes an ephemeral listener for every request; under load that
 * occasionally resets the connection ("socket hang up") or, with two test
 * processes on the machine, lets a request reach the other process's server
 * (measured with supertest 6.3.4 on Node 25: 9 resets in 120,000 requests and
 * one reply from another process, against none in 90,000 when listening once;
 * in paired full E2E runs, 3 of 20 failed before, 0 of 20 after).
 * supertest reuses a server that is listening.
 */
export async function listenForTests(app: INestApplication): Promise<void> {
  await app.init();
  await app.listen(0, '127.0.0.1');
}
