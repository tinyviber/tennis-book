import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { handle, json, readJson } from '@/lib/api';
import { ContentError, isBlobStorage } from '@/lib/runtime-store';
import { requireAdmin } from '@/lib/server-auth';
import { registerTrainingMedia, trainingUploadReservation } from '@/lib/training-media';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    if (!isBlobStorage()) throw new ContentError('当前存储不使用浏览器直传。');
    const input = await readJson(request, 16_384);
    if (input.type === 'blob.generate-client-token') await requireAdmin(request);
    else if (input.type !== 'blob.upload-completed') throw new ContentError('上传请求类型无效。');
    else if (!request.headers.get('x-vercel-signature')) throw new ContentError('上传回调签名无效。', 403);
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new ContentError('上传请求内容无效。');
    const body = input as unknown as HandleUploadBody;
    // handleUpload verifies the provider's signed completion callback. It has no browser cookie.
    const response = await handleUpload({
      body, request,
      onBeforeGenerateToken: async pathname => {
        await requireAdmin(request);
        const asset = await trainingUploadReservation(pathname);
        return { allowedContentTypes: [asset.contentType], maximumSizeInBytes: asset.size, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60_000, tokenPayload: JSON.stringify({ id: asset.id, pathname: asset.pathname }) };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload: { id: string; pathname: string };
        try { payload = JSON.parse(tokenPayload || ''); } catch { throw new ContentError('上传回调凭证无效。'); }
        if (payload.pathname !== blob.pathname) throw new ContentError('上传回调路径无效。');
        await registerTrainingMedia(payload.id, blob.pathname);
      },
    }).catch(error => {
      if (error instanceof Error && /(?:missing|invalid) callback signature/i.test(error.message)) throw new ContentError('上传回调签名无效。', 403);
      throw error;
    });
    return json(response);
  });
}
