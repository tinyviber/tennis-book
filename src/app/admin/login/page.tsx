import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { authConfigured } from '@/lib/auth-store';
import { currentAdmin } from '@/lib/server-auth';
import { LoginForm } from '@/components/admin/LoginForm';
export const metadata = { title: '管理员登录' };
export default async function LoginPage() {
  await connection();
  const configured = authConfigured();
  if (configured && await currentAdmin()) redirect('/admin/');
  return <><header className="site-header"><Link className="wordmark" href="/">书间</Link><span className="header-divider"/><Link href="/" className="header-label">回到书架</Link></header><main className="admin-login"><h1>管理员登录</h1><p>登录后可管理书籍、章节和图片。</p><LoginForm configured={configured}/></main></>;
}
