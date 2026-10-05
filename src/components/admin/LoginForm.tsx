'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest } from './client';
export function LoginForm({ configured, returnTo = '/admin/' }: { configured: boolean; returnTo?: '/admin/' | '/training/' }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      await adminRequest('/api/auth/login/', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
      router.replace(returnTo === '/training/' ? '/training/' : '/admin/'); router.refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="admin-login-form" onSubmit={submit}>
    <label>用户名<input name="username" autoComplete="username" maxLength={100} required disabled={!configured || busy}/></label>
    <label>密码<input name="password" type="password" autoComplete="current-password" required disabled={!configured || busy}/></label>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button className="admin-primary" disabled={!configured || busy}>{busy ? '正在登录…' : returnTo === '/training/' ? '登录私人训练' : '登录管理后台'}</button>
    {!configured && <p className="admin-notice">{returnTo === '/training/' ? <>管理员账号尚未设置。请在项目终端运行 <code>npm run setup-admin</code>，设定自己的账号后重启服务。</> : '管理员账号尚未设置，请联系网站维护者。'}</p>}
  </form>;
}
