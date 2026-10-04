import { getBook } from '@/lib/books';
import { handle, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ book: string }> }) {
  return handle(async () => {
    const book = await getBook((await params).book);
    if (!book) return json({ error: '书籍不存在。' }, 404);
    return json(book.chapters.map(({ slug, title, group, text }) => ({ slug, title, group, text })));
  });
}
