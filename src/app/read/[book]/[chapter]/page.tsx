import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBook, summarizeBook } from '@/lib/books';
import { connection } from 'next/server';
import { ReaderShell } from '@/components/ReaderShell';

type Props = { params:Promise<{book:string;chapter:string}> };
export async function generateMetadata({params}:Props):Promise<Metadata> {
  await connection();
  const p=await params;const book=await getBook(p.book);const chapter=book?.chapters.find(c=>c.slug===p.chapter);
  return {title:chapter ? `${chapter.title} · ${book!.title}` : '页面不存在'};
}
export default async function ChapterPage({params}:Props) {
  await connection();
  const p=await params;const book=await getBook(p.book);const chapter=book?.chapters.find(c=>c.slug===p.chapter);
  if(!book || !chapter) notFound();
  return <ReaderShell key={`${book.slug}/${chapter.slug}`} book={summarizeBook(book)} chapter={chapter.slug} headings={chapter.headings}>
    <header className="article-header"><div className="breadcrumb">{chapter.group}<span>/</span>{chapter.title}</div><h1>{chapter.title}</h1><div className="article-meta">{chapter.pageStart!==null ? `原书第 ${chapter.pageStart}${chapter.pageEnd!==chapter.pageStart ? '–'+chapter.pageEnd : ''} 页` : book.title}<span>约 {chapter.readMinutes} 分钟</span></div></header>
    <div className="book-prose" dangerouslySetInnerHTML={{__html:chapter.html}}/>
  </ReaderShell>;
}
