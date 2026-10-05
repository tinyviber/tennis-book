import { handle, json, limitedBody, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { ContentError, isBlobStorage } from '@/lib/runtime-store';
import { MAX_TRAINING_MEDIA_BYTES, reserveTrainingMedia, uploadTrainingMedia } from '@/lib/training-media';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    if (isBlobStorage()) return json(await reserveTrainingMedia(await readJson(request, 4096)), 201);
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new ContentError('请选择素材文件。', 415);
    const bytes = await limitedBody(request, MAX_TRAINING_MEDIA_BYTES + 16_384);
    let form;
    try { form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
    catch { throw new ContentError('素材上传格式无效。'); }
    const file = form.get('file');
    if (!(file instanceof File)) throw new ContentError('请选择素材文件。');
    return json(await uploadTrainingMedia(file.name, file.type, Buffer.from(await file.arrayBuffer())), 201);
  });
}
