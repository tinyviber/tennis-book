'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { readProgress } from '@/lib/storage';
import type { Progress } from '@/lib/types';
export function ResumeLink({book,first,validChapters}:{book:string;first:string;validChapters:string[]}){
  const [progress,setProgress]=useState<Progress|null>(null);
  useEffect(()=>{const saved=readProgress(book);if(saved&&validChapters.includes(saved.chapter))setProgress(saved)},[book,validChapters]);
  return <div className="resume-area"><Link className="primary-link" href={`/read/${book}/${progress?.chapter||first}/${progress?'?resume=1':''}`}>{progress?'继续阅读':'开始阅读'}<ArrowRight size={18}/></Link>{progress&&<span>上次读到「{progress.title}」</span>}</div>;
}
