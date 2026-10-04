import { currentAdmin } from '@/lib/server-auth';
import { readBookDocument, readImage, revisionOf } from '@/lib/content-store';
import { handle, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ book: string; image: string }> }) {
  return handle(async () => {
    const { book, image } = await params;
    const { metadata } = await readBookDocument(book);
    if (!metadata.published && !await currentAdmin()) return json({ error: '图片不存在。' }, 404);
    const asset = await readImage(book, image), etag = `"${revisionOf(asset.bytes)}"`;
    const headers = { 'Content-Type': `image/${asset.type === 'jpg' ? 'jpeg' : asset.type}`, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', 'ETag': etag };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(asset.bytes), { headers });
  });
}
