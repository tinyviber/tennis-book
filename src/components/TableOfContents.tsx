'use client';
import Link from 'next/link';
import { ChevronDown, ArrowLeft } from 'lucide-react';
import type { BookSummary } from '@/lib/types';

export function TableOfContents({book,current,onNavigate}:{book:BookSummary;current:string;onNavigate?:()=>void}){
  const groups=[...new Set(book.chapters.map(c=>c.group))];
  const activeGroup=book.chapters.find(c=>c.slug===current)?.group;
  return <>
    <Link className="sidebar-book" href="/" onClick={onNavigate}>
      {book.cover ? <img src={book.cover} alt="" width="54" height="72"/> : null}
      <div><strong>{book.title}</strong><span>{book.subtitle}</span></div>
    </Link>
    <nav aria-label="全书目录" className="toc-groups">
      {groups.map((group,index)=><details key={group} open={index<2||group===activeGroup} className="toc-group">
        <summary>{group}<ChevronDown size={15}/></summary>
        <div>{book.chapters.filter(c=>c.group===group).map(c=><Link key={c.slug} href={`/read/${book.slug}/${c.slug}/`} onClick={onNavigate} aria-current={c.slug===current?'page':undefined} className="toc-link">{c.title}</Link>)}</div>
      </details>)}
    </nav>
    <div className="sidebar-footer"><Link href="/" onClick={onNavigate}><ArrowLeft size={14}/>回到书架</Link><details><summary>版本说明</summary><p>{book.sourceNote}</p>{book.publisher&&<p>{book.publisher}<br/>ISBN {book.isbn}</p>}</details></div>
  </>;
}
