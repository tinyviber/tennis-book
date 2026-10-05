'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaAsset, TeachingLesson } from '@/lib/training-types';
import { LessonPlayer } from './LessonPlayer';

export function TodayLesson({ lesson, media, active, onOpen }: { lesson: TeachingLesson; media: MediaAsset[]; active: boolean; onOpen: () => void }) {
  const [index, setIndex] = useState(0);
  const steps = lesson.steps.filter(step => step.confirmed);
  useEffect(() => setIndex(0), [lesson.id]);
  const current = steps[Math.min(index, Math.max(0, steps.length - 1))];
  return <section className="training-panel training-soft today-lesson">
    <div className="training-section-head"><div><span className="training-eyebrow">训练时顺手看</span><h2>{lesson.title}</h2><p>{lesson.summary || '按已核对的步骤练习，需要时回到原资料。'}</p></div><button type="button" className="training-text-button" onClick={onOpen}><BookOpen size={15}/>教学资料</button></div>
    {current ? <>
      <div className="lesson-step-nav"><button type="button" className="training-secondary" disabled={index === 0} onClick={() => setIndex(value => Math.max(0, value - 1))} aria-label="上一个教学步骤"><ChevronLeft size={18}/></button><span>第 {Math.min(index, steps.length - 1) + 1} / {steps.length} 步 · {current.title}</span><button type="button" className="training-secondary" disabled={index >= steps.length - 1} onClick={() => setIndex(value => Math.min(steps.length - 1, value + 1))} aria-label="下一个教学步骤"><ChevronRight size={18}/></button></div>
      <p className="lesson-practice-cue">{current.cue || current.title}</p><p className="lesson-instructions">{current.instructions}</p>{current.repetitions && <p><strong>练习安排：</strong>{current.repetitions}</p>}
      <LessonPlayer key={current.id} step={current} videoAsset={media.find(asset => asset.id === lesson.mediaId)} gifAsset={media.find(asset => asset.id === current.gifMediaId)} active={active} compact/>
      {(current.sourceQuote || current.evidenceAtSeconds !== null) && <details className="lesson-source-quote"><summary>核对这一步的出处</summary>{current.sourceQuote && <blockquote>{current.sourceQuote}</blockquote>}{current.evidenceAtSeconds !== null && <p className="training-muted">画面证据：{current.evidenceAtSeconds.toFixed(2)} 秒</p>}</details>}
    </> : <div className="training-empty"><p>这条教学资料还有待核对的步骤。打开教学资料，检查文字和片段后勾选“已核对”。</p><button type="button" className="training-secondary" onClick={onOpen}>检查教学步骤</button></div>}
    {lesson.sourceUrl && <a className="training-source" href={lesson.sourceUrl} target="_blank" rel="noreferrer">查看原始来源<ArrowUpRight size={13}/></a>}
  </section>;
}
