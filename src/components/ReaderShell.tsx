'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { Menu, Search, ArrowLeft, ArrowRight, X, Maximize2, Minimize2 } from 'lucide-react';
import { TableOfContents } from './TableOfContents';
import { SearchDialog } from './SearchDialog';
import { Preferences } from './Preferences';
import { progressKey,readProgress } from '@/lib/storage';
import type { BookSummary,Heading } from '@/lib/types';
type Figure={src:string;alt:string;width:number;height:number};
export function ReaderShell({book,chapter,headings,children}:{book:BookSummary;chapter:string;headings:Heading[];children:React.ReactNode}){
  const [searchOpen,setSearchOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [progress,setProgress]=useState(0);
  const [figure,setFigure]=useState<Figure|null>(null);
  const [fullSize,setFullSize]=useState(false);
  const drawer=useRef<HTMLDialogElement>(null);
  const lightbox=useRef<HTMLDialogElement>(null);
  const sidebar=useRef<HTMLElement>(null);
  const article=useRef<HTMLElement>(null);
  const index=book.chapters.findIndex(c=>c.slug===chapter);
  const current=book.chapters[index];const previous=book.chapters[index-1];const next=book.chapters[index+1];
  useEffect(()=>{
    const link=sidebar.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if(link&&sidebar.current){const top=link.offsetTop;const height=sidebar.current.clientHeight;if(top>height*.8)sidebar.current.scrollTop=top-height*.4}
    const params=new URLSearchParams(window.location.search);const saved=readProgress(book.slug);
    let frame=0,lastSaved=0,disposed=false;
    const ratio=()=>Math.max(0,Math.min(1,window.scrollY/Math.max(1,document.documentElement.scrollHeight-window.innerHeight)));
    function save(){if(disposed)return;try{localStorage.setItem(progressKey(book.slug),JSON.stringify({chapter,title:current.title,ratio:ratio(),updated:Date.now()}))}catch{}}
    function update(){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{setProgress(Math.round(ratio()*100));if(Date.now()-lastSaved>800){save();lastSaved=Date.now()}})}
    const restore=setTimeout(()=>{
      if(params.get('resume')&&saved?.chapter===chapter)window.scrollTo(0,saved.ratio*(document.documentElement.scrollHeight-window.innerHeight));
      const query=params.get('find');
      if(query&&article.current){
        const container=article.current.querySelector('.book-prose');
        if(container){const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);let node:Node|null;
          while((node=walker.nextNode())){const at=node.textContent?.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())??-1;if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+query.length);const mark=document.createElement('mark');mark.className='search-highlight';range.surroundContents(mark);mark.scrollIntoView({block:'center'});break}}
        }
      }
      update();
    },100);
    window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);window.addEventListener('pagehide',save);
    const shortcut=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true)}};
    document.addEventListener('keydown',shortcut);
    return()=>{save();disposed=true;clearTimeout(restore);cancelAnimationFrame(frame);window.removeEventListener('scroll',update);window.removeEventListener('resize',update);window.removeEventListener('pagehide',save);document.removeEventListener('keydown',shortcut)};
  },[book.slug,chapter,current.title]);
  useEffect(()=>{const d=lightbox.current;if(figure){setFullSize(false);d?.showModal()}else if(d?.open)d.close()},[figure]);
  function openImage(target:EventTarget|null){const img=(target as HTMLElement)?.closest<HTMLImageElement>('.book-prose img');if(img)setFigure({src:img.src,alt:img.alt,width:Number(img.getAttribute('width')),height:Number(img.getAttribute('height'))})}
  return <>
    <a className="skip-link" href="#reading">跳到正文</a>
    <header className="site-header reader-header">
      <button className="mobile-menu icon-button" onClick={()=>drawer.current?.showModal()} aria-label="打开全书目录"><Menu size={21}/></button>
      <Link href="/" className="wordmark">书间</Link><span className="header-divider"/><Link href="/" className="header-label">书架</Link>
      <div className="header-actions"><button className="search-trigger" onClick={()=>setSearchOpen(true)} aria-keyshortcuts="Control+k Meta+k"><Search size={17}/><span>搜索</span></button><span className="header-divider"/><button className="type-trigger" onClick={()=>setSettingsOpen(true)} aria-label="阅读设置">Aa</button></div>
    </header>
    <div className="reading-progress" aria-label={`本节阅读进度 ${progress}%`}><span style={{transform:`scaleX(${progress/100})`}}/></div>
    <aside className="desktop-sidebar" ref={sidebar}><TableOfContents book={book} current={chapter}/></aside>
    <dialog ref={drawer} className="mobile-toc" aria-label="全书目录" onClick={e=>{if(e.target===e.currentTarget)drawer.current?.close()}}><div className="mobile-toc-inner"><button className="drawer-close icon-button" onClick={()=>drawer.current?.close()} aria-label="关闭目录"><X size={20}/></button><TableOfContents book={book} current={chapter} onNavigate={()=>drawer.current?.close()}/></div></dialog>
    <main className="reading-main" id="reading"><article ref={article} className="reading-article" onClick={e=>openImage(e.target)} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&(e.target as HTMLElement).tagName==='IMG'){e.preventDefault();openImage(e.target)}}}>
      {children}
      <nav className="chapter-navigation" aria-label="章节翻页">{previous?<Link href={`/read/${book.slug}/${previous.slug}/`}><small><ArrowLeft size={14}/>上一节</small><span>{previous.title}</span></Link>:<Link href="/"><small><ArrowLeft size={14}/>书架</small><span>{book.title}</span></Link>}{next?<Link href={`/read/${book.slug}/${next.slug}/`}><small>下一节<ArrowRight size={14}/></small><span>{next.title}</span></Link>:<Link href="/"><small>全书已读完<ArrowRight size={14}/></small><span>回到书架</span></Link>}</nav>
      <footer className="article-footer"><span>{index+1} / {book.chapterCount}</span><span>{book.title} · {current.title}</span><span>{progress}%</span></footer>
    </article></main>
    <SearchDialog book={book} open={searchOpen} onClose={()=>setSearchOpen(false)}/>
    <Preferences open={settingsOpen} onClose={()=>setSettingsOpen(false)}/>
    <dialog ref={lightbox} className="figure-dialog" aria-label="图片查看" onClose={()=>setFigure(null)} onClick={e=>{if(e.target===e.currentTarget)setFigure(null)}}>
      {figure&&<><div className="figure-toolbar"><p>{figure.alt}</p><button onClick={()=>setFullSize(v=>!v)} aria-pressed={fullSize} aria-label={fullSize?'适应屏幕':'查看原尺寸'}>{fullSize?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button><button onClick={()=>setFigure(null)} aria-label="关闭图片"><X size={22}/></button></div><div className={`figure-viewport ${fullSize?'full-size':''}`}><img src={figure.src} alt={figure.alt} width={figure.width} height={figure.height}/></div><p className="figure-hint">{fullSize?'可滚动查看原尺寸图片':'点击右上角可查看原尺寸'} · Esc 关闭</p></>}
    </dialog>
  </>;
}
