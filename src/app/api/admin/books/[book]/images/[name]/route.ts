import { requireAdmin } from '@/lib/server-auth';
import { registerUploadedImage, validateImageName, validateSlug } from '@/lib/content-store';
import { handle, json } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ book: string; name: string }> }) {
  return handle(async () => {
    await requireAdmin(request);
    const { book: rawBook, name: rawName } = await params;
    return json(await registerUploadedImage(validateSlug(rawBook), validateImageName(rawName)));
  });
}
