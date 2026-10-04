import { publicPath } from '@/lib/urls';
export async function adminRequest<T>(pathname: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(publicPath(pathname), {
    ...options, cache: 'no-store',
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败。');
  return data as T;
}
