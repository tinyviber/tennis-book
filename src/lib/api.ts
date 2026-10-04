import 'server-only';
import { ContentError } from './content-store';

export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function handle(operation: () => Promise<Response>) {
  try { return await operation(); } catch (error) {
    if (error instanceof ContentError) return json({ error: error.message }, error.status);
    console.error('Request failed:', error);
    return json({ error: '操作失败，请稍后重试。' }, 500);
  }
}
export async function limitedBody(request: Request, maxBytes: number): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > maxBytes) throw new ContentError('请求内容过大。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ContentError('请求内容为空。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ContentError('请求内容过大。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request, limit = 2 * 1024 * 1024 + 8192): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ContentError('请使用 JSON 请求。', 415);
  let value;
  try { value = JSON.parse((await limitedBody(request, limit)).toString('utf8')); }
  catch (error) { if (error instanceof ContentError) throw error; throw new ContentError('JSON 格式不正确。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('请求格式不正确。');
  return value;
}
export function revision(value: unknown, allowCreate = true): string | null {
  if (value === null && allowCreate) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ContentError('缺少有效的内容版本，请重新加载。');
  return value;
}
