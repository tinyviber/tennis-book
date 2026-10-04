import { currentAdmin } from '@/lib/server-auth';
import { isGitContentDeployment, readBookDocument, readImage, revisionOf, validateImageName, validateSlug } from '@/lib/content-store';
import { handle, json } from '@/lib/api';
import { publicPath } from '@/lib/urls';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ book: string; image: string }> }) {
  return handle(async () => {
    const { book, image } = await params;
    const { metadata } = await readBookDocument(book);
    if (!metadata.published && !await currentAdmin()) return json({ error: '图片不存在。' }, 404);
    validateSlug(book);
    validateImageName(image);
    if (isGitContentDeployment()) {
      const location = publicPath(`/books/${book}/images/${encodeURIComponent(image)}`);
      return new Response(null, {
        status: 307,
        headers: { Location: location, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    const asset = await readImage(book, image), etag = `"${revisionOf(asset.bytes)}"`;
    const headers = { 'Content-Type': `image/${asset.type === 'jpg' ? 'jpeg' : asset.type}`, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', 'ETag': etag };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(asset.bytes), { headers });
  });
}
