import { notFound } from 'next/navigation';
import { requireBookAdminPage } from '@/lib/server-auth';
import { ContentError, getEditorBook, readChapterDocument } from '@/lib/content-store';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { BookEditor } from '@/components/admin/BookEditor';
import { connection } from 'next/server';
export const metadata = { title: '编辑书籍' };
export default async function EditorPage({ params }: { params: Promise<{ book: string }> }) {
  await connection();
  const session = await requireBookAdminPage(), { book } = await params;
  let document;
  try { document = await getEditorBook(book); }
  catch (error) { if (error instanceof ContentError && [400, 404].includes(error.status)) notFound(); throw error; }
  const firstChapter = document.chapters[0] ? await readChapterDocument(book, document.chapters[0].slug) : null;
  return <><AdminHeader username={session.username}/><BookEditor key={book} initial={document} firstChapter={firstChapter}/></>;
}
