import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfigured, cookieSettings, readSession, verifyOrigin } from './auth-store';
import { ContentError, isGitContentDeployment } from './content-store';

export async function currentAdmin() {
  if (isGitContentDeployment()) return null;
  if (!authConfigured()) return null;
  return readSession((await cookies()).get(cookieSettings().name)?.value);
}
export async function requireAdmin(request?: Request) {
  if (isGitContentDeployment()) throw new ContentError('线上书籍只读，请在 GitHub 仓库的 data/books 中修改内容并推送。', 403);
  const session = await currentAdmin();
  if (!session) throw new ContentError('请先登录管理员账号。', 401);
  if (request && request.method !== 'GET' && request.method !== 'HEAD') verifyOrigin(request);
  return session;
}
export async function requireAdminPage() {
  if (isGitContentDeployment()) redirect('/admin/login/');
  const session = await currentAdmin();
  if (!session) redirect('/admin/login/');
  return session;
}

/** Git book deployments are immutable; private training uses the same login independently. */
export async function requireBookAdmin(request?: Request) {
  if (isGitContentDeployment()) throw new ContentError('线上书籍只读，请在 GitHub 仓库的 data/books 中修改内容并推送。', 403);
  return requireAdmin(request);
}
export async function requireBookAdminPage() {
  if (isGitContentDeployment()) redirect('/admin/login/');
  return requireAdminPage();
}
