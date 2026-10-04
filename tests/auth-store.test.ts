import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authConfigured, cookieSettings, createSession, hashPassword, login, readSession, revokeSession, verifyOrigin, verifyPassword } from '../src/lib/auth-store';
import { ContentError, dataRoot, revisionOf } from '../src/lib/content-store';
const password = 'Test-password-for-unit-tests';
let hash: string;
before(async () => { hash = await hashPassword(password); });
beforeEach(async () => {
  process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'shujian-auth-'));
  process.env.ADMIN_USERNAME = 'owner'; process.env.ADMIN_PASSWORD_HASH = hash; process.env.APP_URL = 'https://books.example.com';
});
afterEach(async () => {
  await fs.rm(dataRoot(), { recursive: true, force: true });
  for (const key of ['DATA_DIR', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'APP_URL']) delete process.env[key];
});
test('password hashing and missing configuration fail closed', async () => {
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.equal(await verifyPassword(password, 'malformed'), false);
  await assert.rejects(hashPassword('short'));
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.equal(authConfigured(), false);
  await assert.rejects(login('owner', password), (error: unknown) => error instanceof ContentError && error.status === 503);
});
test('sessions use hashed storage, expire, revoke and invalidate on password rotation', async () => {
  const token = await createSession();
  assert.equal((await readSession(token))!.username, 'owner');
  const file = path.join(dataRoot(), 'auth', 'sessions', `${revisionOf(token)}.json`);
  const raw = await fs.readFile(file, 'utf8');
  assert.equal(raw.includes(token), false);
  const expired = JSON.parse(raw); expired.expiresAt = Date.now() - 1;
  await fs.writeFile(file, JSON.stringify(expired));
  assert.equal(await readSession(token), null);
  const revoked = await createSession(); await revokeSession(revoked);
  assert.equal(await readSession(revoked), null);
  const rotated = await createSession(); process.env.ADMIN_USERNAME = 'other-owner';
  assert.equal(await readSession(rotated), null);
  assert.equal(await readSession('../secret'), null);
});
test('persistent account rate limit and successful login', async () => {
  const first = await login('owner', password); assert.ok(await readSession(first));
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(login('unknown', 'wrong'), (error: unknown) => error instanceof ContentError && error.status === 401);
  }
  await assert.rejects(login('owner', password), (error: unknown) => error instanceof ContentError && error.status === 429);
  const file = path.join(dataRoot(), 'auth', 'login-attempts.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(state.attempts, 5);
  state.startedAt = Date.now() - 16 * 60 * 1000;
  await fs.writeFile(file, JSON.stringify(state));
  assert.ok(await readSession(await login('owner', password)));
});
test('CSRF origin is pinned to APP_URL; production cookies are HttpOnly and Secure', () => {
  const settings = cookieSettings();
  assert.equal(settings.name, '__Host-shujian-admin'); assert.equal(settings.httpOnly, true); assert.equal(settings.secure, true); assert.equal(settings.sameSite, 'strict');
  verifyOrigin(new Request('http://internal:3000', { headers: { Origin: 'https://books.example.com' } }));
  assert.throws(() => verifyOrigin(new Request('http://internal:3000')));
  assert.throws(() => verifyOrigin(new Request('http://internal:3000', { headers: { Origin: 'https://attacker.example.com', 'X-Forwarded-Host': 'attacker.example.com' } })));
  assert.throws(() => verifyOrigin(new Request('http://internal:3000', { headers: { Origin: 'https://books.example.com', 'Sec-Fetch-Site': 'cross-site' } })));
});
