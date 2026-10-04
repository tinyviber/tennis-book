import { requireAdmin } from '@/lib/server-auth';
import { ContentError, MAX_IMAGE_BYTES, uploadImage } from '@/lib/content-store';
import { handle, json, limitedBody } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ book: string }> }) {
  return handle(async () => {
    await requireAdmin(request);
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new ContentError('请上传图片文件。', 415);
    const bytes = await limitedBody(request, MAX_IMAGE_BYTES + 8192);
    let form;
    try { form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
    catch { throw new ContentError('上传格式不正确。'); }
    const file = form.get('file');
    if (!(file instanceof File)) throw new ContentError('请选择图片。');
    return json(await uploadImage((await params).book, file.name, Buffer.from(await file.arrayBuffer())), 201);
  });
}
