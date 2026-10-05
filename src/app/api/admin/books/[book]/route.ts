import { requireBookAdmin } from '@/lib/server-auth';
import { getEditorBook, saveBook, trashContent } from '@/lib/content-store';
import { handle, json, readJson, revision } from '@/lib/api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ book: string }> };
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => { await requireBookAdmin(); return json(await getEditorBook((await params).book)); });
}
export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    await requireBookAdmin(request);
    const body = await readJson(request, 32768);
    return json(await saveBook((await params).book, body.metadata, revision(body.revision, false)));
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return handle(async () => {
    await requireBookAdmin(request);
    const body = await readJson(request, 1024);
    await trashContent((await params).book, null, revision(body.revision, false)!);
    return json({ ok: true });
  });
}
