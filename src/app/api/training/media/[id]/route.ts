import { Readable } from 'node:stream';
import { handle, json } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { ContentError, isBlobStorage } from '@/lib/runtime-store';
import { openLocalTrainingMedia, parseByteRange, registerTrainingMedia, signedTrainingMediaUrl, validateMediaId } from '@/lib/training-media';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handle(async () => {
    await requireAdmin();
    const id = validateMediaId((await context.params).id);
    if (isBlobStorage()) {
      const { url } = await signedTrainingMediaUrl(id);
      return new Response(null, { status: 307, headers: { Location: url, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    const { handle: file, size, asset } = await openLocalTrainingMedia(id);
    const headers: Record<string, string> = { 'Content-Type': asset.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    let range;
    try { range = parseByteRange(request.headers.get('range'), size); }
    catch (error) {
      await file.close();
      if (error instanceof ContentError && error.status === 416) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      throw error;
    }
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
    } else headers['Content-Length'] = String(size);
    if (request.method === 'HEAD') {
      await file.close();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    const stream = file.createReadStream({ ...(range ? { start: range.start, end: range.end } : {}), autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
  });
}
export const HEAD = GET;
export async function POST(request: Request, context: Context) {
  return handle(async () => { await requireAdmin(request); return json(await registerTrainingMedia(validateMediaId((await context.params).id))); });
}
