import { cookies } from 'next/headers';
import { cookieSettings, revokeSession, verifyOrigin } from '@/lib/auth-store';
import { handle, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    verifyOrigin(request);
    const jar = await cookies(), settings = cookieSettings();
    await revokeSession(jar.get(settings.name)?.value);
    jar.set(settings.name, '', { ...settings, maxAge: 0 });
    return json({ ok: true });
  });
}
