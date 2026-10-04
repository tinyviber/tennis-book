'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { upload as uploadBlob } from '@vercel/blob/client';
import type { BookMetadata, ChapterDocument, EditorBook } from '@/lib/types';
import { publicPath } from '@/lib/urls';
import { adminRequest } from './client';

const emptyChapter = (order: number) => `---\ntitle: 新章节\norder: ${order}\ngroup: 正文\npublished: false\n---\n\n在这里写正文。\n`;
export function BookEditor({ initial, firstChapter }: { initial: EditorBook; firstChapter: ChapterDocument | null }) {
  const router = useRouter(), sourceInput = useRef<HTMLTextAreaElement>(null);
  const [book, setBook] = useState(initial);
  const [metadata, setMetadata] = useState(initial.metadata);
  const [chapter, setChapter] = useState(firstChapter);
  const [slug, setSlug] = useState(firstChapter?.slug || '');
  const [source, setSource] = useState(firstChapter?.source || emptyChapter(1));
  const [preview, setPreview] = useState<{ html: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [imageQuery, setImageQuery] = useState('');
  const [visibleImages, setVisibleImages] = useState(24);
  const [metadataDirty, setMetadataDirty] = useState(false), [chapterDirty, setChapterDirty] = useState(false);
  const bookSlug = book.metadata.slug, base = `/api/admin/books/${bookSlug}/`;
  useEffect(() => {
    if (!metadataDirty && !chapterDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [metadataDirty, chapterDirty]);
  function changeMetadata<K extends keyof BookMetadata>(key: K, value: BookMetadata[K]) {
    setMetadata(current => ({ ...current, [key]: value })); setMetadataDirty(true);
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await operation(); } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function refreshBook() {
    const updated = await adminRequest<EditorBook>(base);
    setBook(current => ({ ...updated, metadata: current.metadata, revision: current.revision }));
    return updated;
  }
  function saveMetadata(event: React.FormEvent) {
    event.preventDefault();
    void run(async () => {
      const saved = await adminRequest<{ metadata: BookMetadata; revision: string }>(base, { method: 'PUT', body: JSON.stringify({ metadata, revision: book.revision }) });
      setBook(current => ({ ...current, ...saved })); setMetadata(saved.metadata); setMetadataDirty(false);
      setMessage('书籍资料已保存。'); router.refresh();
    });
  }
  function selectChapter(nextSlug: string) {
    if (chapterDirty && !window.confirm('当前章节尚未保存，放弃修改并切换？')) return;
    void run(async () => {
      const next = await adminRequest<ChapterDocument>(`${base}chapters/${nextSlug}/`);
      setChapter(next); setSlug(next.slug); setSource(next.source); setChapterDirty(false); setPreview(null);
    });
  }
  function newChapter() {
    if (chapterDirty && !window.confirm('当前章节尚未保存，放弃修改并新建？')) return;
    setChapter(null); setSlug(''); setSource(emptyChapter(Math.max(0, ...book.chapters.map(item => item.order)) + 1));
    setChapterDirty(false); setPreview(null); setMessage(''); setError('');
  }
  function saveChapter(event: React.FormEvent) {
    event.preventDefault();
    void run(async () => {
      const saved = await adminRequest<ChapterDocument>(`${base}chapters/${slug}/`, { method: 'PUT', body: JSON.stringify({ source, revision: chapter?.revision ?? null }) });
      setChapter(saved); setChapterDirty(false); setPreview(null); await refreshBook();
      setMessage(saved.published && book.metadata.published ? '章节已保存，读者刷新页面即可看到更新。' : '章节草稿已保存。'); router.refresh();
    });
  }
  function showPreview() {
    void run(async () => {
      if (!slug) throw new Error('请先填写章节标识。');
      setPreview(await adminRequest<{ html: string; title: string }>(`${base}chapters/${slug}/`, { method: 'POST', body: JSON.stringify({ source }) }));
    });
  }
  function insertImage(name: string, alt = '图片说明') {
    const input = sourceInput.current;
    const start = input?.selectionStart ?? source.length, end = input?.selectionEnd ?? start;
    const markdown = `\n\n![${alt.replace(/[\[\]\r\n]/g, '')}](../images/${name})\n\n`;
    setSource(value => value.slice(0, start) + markdown + value.slice(end));
    setChapterDirty(true); setPreview(null);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + markdown.length, start + markdown.length); });
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    void run(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB。');
      let image: { name: string };
      if (process.env.NEXT_PUBLIC_STORAGE_DRIVER === 'vercel-blob') {
        const extension = file.name.match(/\.(webp|png|jpe?g|gif)$/i)?.[0].toLowerCase();
        if (!extension) throw new Error('请使用 WebP、PNG、JPEG 或 GIF 图片。');
        const name = `${crypto.randomUUID()}${extension}`;
        const pathname = `books/${bookSlug}/images/${name}`;
        const blob = await uploadBlob(pathname, file, {
          access: 'private',
          handleUploadUrl: publicPath(`${base}images/`),
        });
        if (blob.pathname !== pathname) throw new Error('图片上传路径不正确。');
        image = await adminRequest<{ name: string }>(`${base}images/${name}/`, { method: 'POST' });
      } else {
        const data = new FormData(); data.append('file', file);
        image = await adminRequest<{ name: string }>(`${base}images/`, { method: 'POST', body: data });
      }
      setBook(current => ({ ...current, images: [image.name, ...current.images] }));
      insertImage(image.name, file.name.replace(/\.[^.]+$/, ''));
      setMessage('图片已上传并插入正文，保存章节后生效。');
    });
  }
  function deleteChapter() {
    if (!chapter || !window.confirm(`将「${chapter.title}」移入回收目录？`)) return;
    void run(async () => {
      await adminRequest(`${base}chapters/${chapter.slug}/`, { method: 'DELETE', body: JSON.stringify({ revision: chapter.revision }) });
      await refreshBook(); setChapter(null); setSlug(''); setSource(emptyChapter(1)); setChapterDirty(false); setPreview(null);
      setMessage('章节已移入回收目录。'); router.refresh();
    });
  }
  function deleteBook() {
    if (!window.confirm(`将「${book.metadata.title}」及全部章节和图片移入回收目录？`)) return;
    void run(async () => {
      await adminRequest(base, { method: 'DELETE', body: JSON.stringify({ revision: book.revision }) });
      setMetadataDirty(false); setChapterDirty(false); router.push('/admin/'); router.refresh();
    });
  }
  const filteredImages = book.images.filter(name => name.toLowerCase().includes(imageQuery.toLowerCase()));
  return <main className="admin-main admin-editor">
    <Link className="admin-back" href="/admin/" onClick={event => { if ((chapterDirty || metadataDirty) && !window.confirm('有尚未保存的修改，放弃并返回？')) event.preventDefault(); }}>← 全部书籍</Link>
    <div className="admin-intro"><h1>{book.metadata.title}</h1><p>{book.metadata.published ? '书籍已发布，已发布章节的修改会直接更新阅读页面。' : '书籍是草稿，发布后才会显示在书架。'}</p></div>
    <div className="admin-feedback" aria-live="polite">{error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-success">{message}</p>}</div>
    <details className="admin-panel admin-metadata"><summary>书籍资料 <span>{metadataDirty ? '有未保存的修改' : '书名、封面与发布状态'}</span></summary>
      <form onSubmit={saveMetadata}><fieldset disabled={busy} className="admin-fields">
        <label>书名<input required maxLength={256} value={metadata.title} onChange={event => changeMetadata('title', event.target.value)}/></label>
        <label>副标题<input value={metadata.subtitle} onChange={event => changeMetadata('subtitle', event.target.value)}/></label>
        <label className="admin-full">简介<textarea rows={2} value={metadata.description} onChange={event => changeMetadata('description', event.target.value)}/></label>
        <label>作者（用顿号分隔）<input value={metadata.authors.join('、')} onChange={event => changeMetadata('authors', event.target.value.split('、'))}/></label>
        <label>译者<input value={metadata.translator || ''} onChange={event => changeMetadata('translator', event.target.value)}/></label>
        <label>出版社<input value={metadata.publisher || ''} onChange={event => changeMetadata('publisher', event.target.value)}/></label>
        <label>ISBN<input value={metadata.isbn || ''} onChange={event => changeMetadata('isbn', event.target.value)}/></label>
        <label>语言<input value={metadata.language} onChange={event => changeMetadata('language', event.target.value)}/></label>
        <label>封面<select value={metadata.cover?.replace(/^\.\//, '') || ''} onChange={event => changeMetadata('cover', event.target.value ? `./${event.target.value}` : null)}><option value="">无封面</option>{book.images.map(name => <option key={name} value={`images/${name}`}>{name}</option>)}</select></label>
        <label className="admin-full">版本说明<textarea rows={2} value={metadata.sourceNote} onChange={event => changeMetadata('sourceNote', event.target.value)}/></label>
        <label className="admin-check admin-full"><input type="checkbox" checked={metadata.published} onChange={event => changeMetadata('published', event.target.checked)}/>发布这本书（至少有一个已发布章节才会出现在书架）</label>
        <div className="admin-row admin-full"><button className="admin-primary">保存书籍资料</button><button className="admin-danger" type="button" onClick={deleteBook}>移除书籍</button></div>
      </fieldset></form>
    </details>
    <div className="admin-editor-grid"><aside className="admin-panel admin-chapters"><div className="admin-section-title"><h2>章节 · {book.chapters.length}</h2><button type="button" disabled={busy} onClick={newChapter}>＋ 新建</button></div><nav aria-label="编辑章节">{book.chapters.map(item => <button key={item.slug} disabled={busy} className={chapter?.slug === item.slug ? 'selected' : ''} onClick={() => selectChapter(item.slug)}><span>{item.order}. {item.title}</span><small>{item.published ? item.group : '草稿'}</small></button>)}</nav></aside>
      <section className="admin-panel admin-chapter-editor"><div className="admin-section-title"><h2>{chapter ? `编辑：${chapter.title}` : '新建章节'}</h2>{chapter?.published && book.metadata.published && <Link target="_blank" rel="noopener" href={`/read/${bookSlug}/${chapter.slug}/`}>查看阅读页面 ↗</Link>}</div>
        <form onSubmit={saveChapter}><fieldset disabled={busy}>
          <label>章节标识<input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} disabled={busy || chapter !== null} placeholder="例如：48-training-notes" onChange={event => { setSlug(event.target.value); setChapterDirty(true); }}/></label>
          <p className="admin-help">顶部资料区设置标题、顺序和分组；<code>published: true</code> 发布章节，<code>false</code> 保存为草稿。</p>
          <div className="admin-row admin-editor-toolbar"><span>Markdown 正文 {chapterDirty && '· 未保存'}</span><button type="button" className="admin-secondary" onClick={showPreview}>预览正文</button><label className="admin-secondary admin-upload">上传图片<input type="file" accept="image/webp,image/png,image/jpeg,image/gif" onChange={upload} disabled={busy}/></label></div>
          <label className="admin-source-label"><span className="sr-only">章节 Markdown</span><textarea ref={sourceInput} className="admin-source" aria-label="章节 Markdown" spellCheck={false} value={source} onChange={event => { setSource(event.target.value); setChapterDirty(true); setPreview(null); }}/></label>
          <div className="admin-row"><button className="admin-primary">{busy ? '处理中…' : '保存章节'}</button>{chapter && <button type="button" className="admin-danger" onClick={deleteChapter}>移除章节</button>}</div>
        </fieldset></form>
        {preview && <section className="admin-preview"><div className="admin-section-title"><h2>{preview.title} · 预览</h2><button onClick={() => setPreview(null)}>收起</button></div><div className="book-prose" dangerouslySetInnerHTML={{ __html: preview.html }}/></section>}
        <details className="admin-image-library"><summary>图片库 · {book.images.length} 张</summary><p className="admin-help">点击图片插入正文；上传的图片也可在书籍资料中选为封面。</p><label>搜索文件名<input value={imageQuery} onChange={event => { setImageQuery(event.target.value); setVisibleImages(24); }}/></label><div className="admin-image-grid">{filteredImages.slice(0, visibleImages).map(name => <button type="button" key={name} disabled={busy} onClick={() => insertImage(name)} title={name}><img loading="lazy" src={publicPath(`/media/${bookSlug}/${encodeURIComponent(name)}/`)} alt={name}/><span>{name}</span></button>)}</div>{filteredImages.length > visibleImages && <button type="button" className="admin-secondary" onClick={() => setVisibleImages(value => value + 24)}>显示更多</button>}</details>
      </section>
    </div>
  </main>;
}
