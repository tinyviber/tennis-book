import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { authConfigured } from '@/lib/auth-store';
import { currentAdmin } from '@/lib/server-auth';
import { LoginForm } from '@/components/admin/LoginForm';

export const metadata = { title: '私人训练登录' };

export default async function TrainingLoginPage() {
  await connection();
  const configured = authConfigured();
  if (configured && await currentAdmin()) redirect('/training/');
  return <>
    <header className="site-header"><Link className="wordmark" href="/">书间</Link><span className="header-divider"/><Link href="/" className="header-label">回到书架</Link></header>
    <main className="admin-login"><h1>私人训练</h1><p>登录后查看你的录像、训练记录和每周安排。</p><LoginForm configured={configured} returnTo="/training/"/></main>
  </>;
}
