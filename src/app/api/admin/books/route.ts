import { requireBookAdmin } from '@/lib/server-auth';
import { listBookDocuments, saveBook, validateSlug, ContentError } from '@/lib/content-store';
import { handle, json, readJson } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET() {
  return handle(async () => { await requireBookAdmin(); return json(await listBookDocuments()); });
}
export async function POST(request: Request) {
  return handle(async () => {
    await requireBookAdmin(request);
    const body = await readJson(request, 32768);
    if (typeof body.slug !== 'string') throw new ContentError('请填写书籍标识。');
    return json(await saveBook(validateSlug(body.slug), { ...body, published: false }, null), 201);
  });
}
