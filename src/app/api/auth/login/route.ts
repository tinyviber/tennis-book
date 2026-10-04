import { cookies } from 'next/headers';
import { login, cookieSettings, revokeSession, verifyOrigin } from '@/lib/auth-store';
import { ContentError } from '@/lib/content-store';
import { handle, json, readJson } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    verifyOrigin(request);
    const body = await readJson(request, 4096);
    if (typeof body.username !== 'string' || body.username.length > 100 || typeof body.password !== 'string' || Buffer.byteLength(body.password) > 1024) throw new ContentError('用户名或密码格式不正确。');
    const token = await login(body.username, body.password);
    const jar = await cookies(), settings = cookieSettings();
    await revokeSession(jar.get(settings.name)?.value);
    jar.set(settings.name, token, settings);
    return json({ ok: true });
  });
}
