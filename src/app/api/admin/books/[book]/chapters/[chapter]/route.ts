import { requireBookAdmin } from '@/lib/server-auth';
import { ContentError, readChapterDocument, renderChapter, saveChapter, trashContent } from '@/lib/content-store';
import { handle, json, readJson, revision } from '@/lib/api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ book: string; chapter: string }> };
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    await requireBookAdmin();
    const { book, chapter } = await params;
    return json(await readChapterDocument(book, chapter));
  });
}
export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    await requireBookAdmin(request);
    const body = await readJson(request), { book, chapter } = await params;
    if (typeof body.source !== 'string') throw new ContentError('请填写章节内容。');
    return json(await saveChapter(book, chapter, body.source, revision(body.revision)));
  });
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    await requireBookAdmin(request);
    const body = await readJson(request), { book, chapter } = await params;
    if (typeof body.source !== 'string') throw new ContentError('请填写章节内容。');
    return json(await renderChapter(book, chapter, body.source));
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return handle(async () => {
    await requireBookAdmin(request);
    const body = await readJson(request, 1024), { book, chapter } = await params;
    await trashContent(book, chapter, revision(body.revision, false)!);
    return json({ ok: true });
  });
}
