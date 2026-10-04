import path from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ContentError, atomicWrite, dataRoot, isMissing, listDataEntries, readDataFile, removeDataFile, revisionOf, serialized } from './content-store';

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HASH_PATTERN = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/;
export const SESSION_SECONDS = 12 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const authRoot = () => path.join(dataRoot(), 'auth');
async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password) > 1024) throw new ContentError('管理员密码至少 12 个字符，最多 1024 字节。');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(hash);
  if (!match || Buffer.byteLength(password) > 1024) return false;
  return timingSafeEqual(await derive(password, match[1]), Buffer.from(match[2], 'hex'));
}
export function authConfigured(): boolean {
  return !!process.env.ADMIN_USERNAME && HASH_PATTERN.test(process.env.ADMIN_PASSWORD_HASH || '');
}
export function appOrigin(): string {
  const configured = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw new ContentError('请在服务器配置 APP_URL。', 503);
    return 'http://localhost:3000';
  }
  let url;
  try { url = new URL(configured); } catch { throw new ContentError('APP_URL 配置不正确。', 503); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ContentError('APP_URL 配置不正确。', 503);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ContentError('生产环境的 APP_URL 必须使用 HTTPS。', 503);
  }
  return url.origin;
}
export function cookieSettings() {
  const secure = appOrigin().startsWith('https:');
  return { name: secure ? '__Host-shujian-admin' : 'shujian-admin', httpOnly: true, secure, sameSite: 'strict' as const, path: '/', maxAge: SESSION_SECONDS };
}
export function verifyOrigin(request: Request): void {
  if (request.headers.get('origin') !== appOrigin() || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ContentError('请求来源无效。请从本站管理页面操作。', 403);
  }
}
const credentialVersion = () => revisionOf(`${process.env.ADMIN_USERNAME}\n${process.env.ADMIN_PASSWORD_HASH}`);
export type Session = { username: string; expiresAt: number; credentialVersion: string };
export async function createSession() {
  if (!authConfigured()) throw new ContentError('管理员尚未配置。', 503);
  const token = randomBytes(32).toString('hex');
  const session: Session = { username: process.env.ADMIN_USERNAME!, expiresAt: Date.now() + SESSION_SECONDS * 1000, credentialVersion: credentialVersion() };
  await atomicWrite(path.join(authRoot(), 'sessions', `${revisionOf(token)}.json`), JSON.stringify(session), { ifAbsent: true });
  return token;
}
export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !authConfigured()) return null;
  const file = path.join(authRoot(), 'sessions', `${revisionOf(token)}.json`);
  let session: Session;
  try { session = JSON.parse((await readDataFile(file)).bytes.toString('utf8')); }
  catch (error) { if (isMissing(error) || error instanceof SyntaxError) return null; throw error; }
  if (typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now() || session.credentialVersion !== credentialVersion() || session.username !== process.env.ADMIN_USERNAME) {
    await removeDataFile(file);
    return null;
  }
  return session;
}
export async function revokeSession(token: string | undefined): Promise<void> {
  if (token && /^[a-f0-9]{64}$/.test(token)) await removeDataFile(path.join(authRoot(), 'sessions', `${revisionOf(token)}.json`));
}
// A global account limit cannot be bypassed by spoofing a forwarded IP header.
// The counter survives restarts; checks are serialized before expensive password work.
export async function login(username: string, password: string): Promise<string> {
  if (!authConfigured()) throw new ContentError('管理员尚未配置，请运行 npm run setup-admin。', 503);
  return serialized('auth:login', async () => {
    const file = path.join(authRoot(), 'login-attempts.json');
    let saved = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      let current: Awaited<ReturnType<typeof readDataFile>> | null = null;
      try { current = await readDataFile(file); } catch (error) { if (!isMissing(error)) throw error; }
      let state = { startedAt: Date.now(), attempts: 0 };
      if (current) state = JSON.parse(current.bytes.toString('utf8'));
      if (Date.now() - state.startedAt >= WINDOW_MS) state = { startedAt: Date.now(), attempts: 0 };
      if (state.attempts >= 5) throw new ContentError('登录尝试过多，请在 15 分钟后重试。', 429);
      state.attempts++;
      try {
        await atomicWrite(file, JSON.stringify(state), current ? { ifMatch: current.etag } : { ifAbsent: true });
        saved = true;
        break;
      } catch (error) {
        if (!(error instanceof ContentError && error.status === 409)) throw error;
      }
    }
    if (!saved) throw new ContentError('登录状态正在被更新，请稍后重试。', 503);
    const validPassword = await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH!);
    if (username !== process.env.ADMIN_USERNAME || !validPassword) throw new ContentError('用户名或密码不正确。', 401);
    await removeDataFile(file);
    // Remove expired or rotated sessions on successful login.
    const directory = path.join(authRoot(), 'sessions');
    try {
      for (const { name, isDirectory } of await listDataEntries(directory)) {
        if (isDirectory || !/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const session = JSON.parse((await readDataFile(path.join(directory, name))).bytes.toString('utf8')) as Session;
        if (session.expiresAt <= Date.now() || session.credentialVersion !== credentialVersion()) await removeDataFile(path.join(directory, name));
      }
    } catch (error) { if (!isMissing(error)) throw error; }
    return createSession();
  });
}
