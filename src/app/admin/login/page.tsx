import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { authConfigured } from '@/lib/auth-store';
import { currentAdmin } from '@/lib/server-auth';
import { isGitContentDeployment } from '@/lib/content-store';
import { LoginForm } from '@/components/admin/LoginForm';
export const metadata = { title: '管理员登录' };
export default async function LoginPage() {
  await connection();
  const gitManaged = isGitContentDeployment();
  const configured = authConfigured();
  if (configured && await currentAdmin()) redirect('/admin/');
  return <><header className="site-header"><Link className="wordmark" href="/">书间</Link><span className="header-divider"/><Link href="/" className="header-label">回到书架</Link></header><main className="admin-login"><h1>{gitManaged ? '内容管理' : '管理员登录'}</h1>{gitManaged ? <p>线上书籍只读。请在 GitHub 仓库的 <code>data/books/</code> 中修改内容并推送，Vercel 会自动重新部署。</p> : <><p>登录后可管理书籍、章节和图片。</p><LoginForm configured={configured}/></>}</main></>;
}
