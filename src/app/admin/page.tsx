import { requireBookAdminPage } from '@/lib/server-auth';
import { listBookDocuments } from '@/lib/content-store';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { BookManager } from '@/components/admin/BookManager';
import { connection } from 'next/server';
export const metadata = { title: '内容管理' };
export default async function AdminPage() {
  await connection();
  const session = await requireBookAdminPage();
  return <><AdminHeader username={session.username}/><BookManager books={await listBookDocuments()}/></>;
}
