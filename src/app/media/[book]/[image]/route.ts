import { BlobNotFoundError, head } from '@vercel/blob';
import { currentAdmin } from '@/lib/server-auth';
import { ContentError, isBlobStorage, readBookDocument, readImage, readImageInfo, revisionOf, signedBlobReadUrl, validateImageName, validateSlug } from '@/lib/content-store';
import { handle, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ book: string; image: string }> }) {
  return handle(async () => {
    const { book, image } = await params;
    const { metadata } = await readBookDocument(book);
    if (!metadata.published && !await currentAdmin()) return json({ error: '图片不存在。' }, 404);
    if (isBlobStorage()) {
      validateSlug(book);
      validateImageName(image);
      await readImageInfo(book, image);
      let blob;
      try { blob = await head(`books/${book}/images/${image}`); }
      catch (error) {
        if (error instanceof BlobNotFoundError) throw new ContentError('图片不存在。', 404);
        throw error;
      }
      const location = await signedBlobReadUrl(blob.pathname);
      return new Response(null, {
        status: 307,
        headers: { Location: location, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    const asset = await readImage(book, image), etag = `"${revisionOf(asset.bytes)}"`;
    const headers = { 'Content-Type': `image/${asset.type === 'jpg' ? 'jpeg' : asset.type}`, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', 'ETag': etag };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(asset.bytes), { headers });
  });
}
