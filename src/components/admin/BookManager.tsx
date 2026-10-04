'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BookDocument } from '@/lib/types';
import { adminRequest } from './client';
export function BookManager({ books }: { books: BookDocument[] }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const router = useRouter();
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget), slug = String(data.get('slug'));
    try {
      await adminRequest('/api/admin/books/', { method: 'POST', body: JSON.stringify({ slug, title: data.get('title') }) });
      router.push(`/admin/books/${slug}/`); router.refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="admin-main"><div className="admin-intro"><h1>内容管理</h1><p>添加书籍、编辑章节和上传图片。保存已发布内容后，读者即可看到更新。</p></div>
    <div className="admin-book-list">{books.map(book => <Link className="admin-book-card" href={`/admin/books/${book.metadata.slug}/`} key={book.metadata.slug}><div><h2>{book.metadata.title}</h2><p>{book.metadata.subtitle || book.metadata.slug}</p></div><span className="admin-badge">{book.metadata.published ? '已发布' : '草稿'}</span><small>{book.chapterCount} 节</small><span>编辑 →</span></Link>)}</div>
    {books.length === 0 && <p className="admin-notice">还没有书籍，请先添加一本。</p>}
    <section className="admin-panel"><h2>添加书籍</h2><form className="admin-create-form" onSubmit={create}><label>书名<input name="title" required maxLength={256} placeholder="例如：网球训练笔记" disabled={busy}/></label><label>书籍标识<input name="slug" aria-label="书籍标识" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} placeholder="例如：tennis-notes" disabled={busy}/><small>用于网址，创建后保持不变。</small></label><button className="admin-primary" disabled={busy}>{busy ? '正在添加…' : '添加为草稿'}</button></form>{error && <p className="admin-error" role="alert">{error}</p>}</section>
  </main>;
}
