'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { Search, X, ArrowUpRight } from 'lucide-react';
import type { BookSummary,SearchEntry } from '@/lib/types';
import { publicPath } from '@/lib/urls';
export function SearchDialog({book,open,onClose}:{book:BookSummary;open:boolean;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState('');
  const [entries,setEntries]=useState<SearchEntry[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{const d=dialog.current;if(open){d?.showModal();input.current?.focus()}else if(d?.open)d.close()},[open]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setLoading(true);setError(false);
    fetch(publicPath(`/api/books/${book.slug}/search/`),{signal:controller.signal,cache:'no-store'})
      .then(response=>{if(!response.ok)throw new Error('Search unavailable');return response.json()})
      .then((data:SearchEntry[])=>{setEntries(data);setLoading(false)})
      .catch(err=>{if(err.name!=='AbortError'){setError(true);setLoading(false)}});
    return()=>controller.abort();
  },[open,book.slug,attempt]);
  const needle=query.trim().toLocaleLowerCase();
  const terms=needle.split(/\s+/).filter(Boolean);
  const results=needle ? entries.map(entry=>{
    const text=entry.text.toLocaleLowerCase();const title=entry.title.toLocaleLowerCase();
    const match=terms.every(term=>title.includes(term)||text.includes(term));
    return {entry,match,score:terms.reduce((n,t)=>n+(title.includes(t)?50:0),0),position:text.indexOf(terms[0])};
  }).filter(r=>r.match).sort((a,b)=>b.score-a.score).slice(0,20) : [];
  function snippet(entry:SearchEntry,position:number){const from=Math.max(0,position-28);return (from>0?'…':'')+entry.text.slice(from,from+130)+(from+130<entry.text.length?'…':'')}
  return <dialog ref={dialog} className="search-dialog" onClose={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}} aria-label="搜索本书">
    <div className="search-bar"><Search size={20}/><input ref={input} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索章节、动作或战术…" aria-label="搜索本书正文"/><button aria-label="关闭搜索" onClick={onClose}><X size={20}/></button></div>
    <div className="search-results">
      {loading?<p className="search-message">正在加载正文…</p>:error?<div className="search-message">搜索暂时无法加载。<button className="text-button" onClick={()=>setAttempt(n=>n+1)}>重试</button></div>:!needle?<p className="search-message">在《{book.title}》的 {book.chapterCount} 节正文中搜索。</p>:results.length===0?<p className="search-message">没有找到「{query}」，可以换一个词试试。</p>:<>
        <p className="search-count">{results.length===20?'至少 20':results.length} 个相关章节</p>
        {results.map(({entry,position})=><Link key={entry.slug} href={`/read/${book.slug}/${entry.slug}/?find=${encodeURIComponent(query.trim())}`} onClick={()=>{setQuery('');onClose()}} className="search-result"><div><strong>{entry.title}</strong><small>{entry.group}</small><ArrowUpRight size={16}/></div><p>{snippet(entry,position)}</p></Link>)}
      </>}
    </div><footer><span>Enter 可聚焦结果后打开</span><span>Esc 关闭</span></footer>
  </dialog>;
}
