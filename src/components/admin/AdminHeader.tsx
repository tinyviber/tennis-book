'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminRequest } from './client';
export function AdminHeader({ username }: { username: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true); setError('');
    try { await adminRequest('/api/auth/logout/', { method: 'POST' }); router.replace('/admin/login/'); router.refresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <><header className="site-header admin-header"><Link href="/" className="wordmark">书间</Link><span className="header-divider"/><Link href="/admin/">内容管理</Link><div className="admin-header-actions"><span>{username}</span><button disabled={busy} onClick={logout}>退出登录</button></div></header>{error && <p className="admin-error" role="alert">{error}</p>}</>;
}
