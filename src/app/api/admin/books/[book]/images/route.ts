import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { requireAdmin } from '@/lib/server-auth';
import { ContentError, isBlobStorage, MAX_IMAGE_BYTES, readBookDocument, uploadImage, validateImageName, validateSlug } from '@/lib/content-store';
import { handle, json, limitedBody } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ book: string }> }) {
  return handle(async () => {
    if (isBlobStorage()) {
      let body: HandleUploadBody;
      try { body = await request.json() as HandleUploadBody; }
      catch { throw new ContentError('上传请求格式不正确。', 400); }
      const { book: rawBook } = await params, book = validateSlug(rawBook);
      const response = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async pathname => {
          await requireAdmin(request);
          await readBookDocument(book);
          const prefix = `books/${book}/images/`;
          if (!pathname.startsWith(prefix)) throw new ContentError('图片上传路径无效。', 400);
          const name = pathname.slice(prefix.length);
          validateImageName(name);
          if (pathname !== `${prefix}${name}`) throw new ContentError('图片上传路径无效。', 400);
          return {
            allowedContentTypes: ['image/webp', 'image/png', 'image/jpeg', 'image/gif'],
            maximumSizeInBytes: MAX_IMAGE_BYTES,
            addRandomSuffix: false,
            tokenPayload: JSON.stringify({ book, name }),
          };
        },
        onUploadCompleted: async () => {},
      });
      return json(response);
    }
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
