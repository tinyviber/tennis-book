import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfigured, cookieSettings, readSession, verifyOrigin } from './auth-store';
import { ContentError } from './content-store';

export async function currentAdmin() {
  if (!authConfigured()) return null;
  return readSession((await cookies()).get(cookieSettings().name)?.value);
}
export async function requireAdmin(request?: Request) {
  const session = await currentAdmin();
  if (!session) throw new ContentError('请先登录管理员账号。', 401);
  if (request && request.method !== 'GET' && request.method !== 'HEAD') verifyOrigin(request);
  return session;
}
export async function requireAdminPage() {
  const session = await currentAdmin();
  if (!session) redirect('/admin/login/');
  return session;
}
