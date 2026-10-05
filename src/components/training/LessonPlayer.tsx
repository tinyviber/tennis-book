'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Repeat } from 'lucide-react';
import type { MediaAsset, TeachingStep } from '@/lib/training-types';
import { timestamp } from './client';

type Props = { step: TeachingStep; videoAsset?: MediaAsset; gifAsset?: MediaAsset; active: boolean; compact?: boolean };

/** Replays an original source range; generated GIFs stay a separately chosen view. */
export function LessonPlayer({ step, videoAsset, gifAsset, active, compact = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [error, setError] = useState('');
  const hasRange = step.startSeconds !== null && step.endSeconds !== null && step.endSeconds > step.startSeconds;
  const videoReady = videoAsset?.status === 'ready' && videoAsset.contentType.startsWith('video/');
  const gifReady = gifAsset?.status === 'ready' && gifAsset.contentType === 'image/gif';

  useEffect(() => { setPlaying(false); setShowGif(false); setError(''); }, [videoAsset?.id, step.startSeconds, step.endSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || showGif) video?.pause();
    const pauseHidden = () => { if (document.hidden) video?.pause(); };
    document.addEventListener('visibilitychange', pauseHidden);
    return () => { video?.pause(); document.removeEventListener('visibilitychange', pauseHidden); };
  }, [active, showGif, videoAsset?.id, step.startSeconds, step.endSeconds]);

  useEffect(() => {
    if (!active || !playing || !loop || !hasRange || showGif) return;
    let request = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused && step.startSeconds !== null && step.endSeconds !== null && video.currentTime >= step.endSeconds) video.currentTime = step.startSeconds;
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [active, playing, loop, hasRange, showGif, step.startSeconds, step.endSeconds]);

  async function playRange() {
    const video = videoRef.current;
    if (!video || !active) return;
    setShowGif(false); setError('');
    if (hasRange && step.startSeconds !== null) video.currentTime = step.startSeconds;
    video.playbackRate = slow ? .5 : 1;
    try { await video.play(); } catch { setError('播放尚未开始，请用录像上的播放按钮重试。'); }
  }

  if (!videoReady && !gifReady) return (step.gifMediaId || (hasRange && videoAsset === undefined)) ? <p className="training-muted">片段素材暂不可用。步骤文字仍可以查看，请在教学资料中重新关联原片。</p> : null;

  return <div className={`lesson-player${compact ? ' lesson-player-compact' : ''}`}>
    {showGif && gifReady ? active ? <img className="lesson-gif" src={gifAsset.url} alt={`${step.title}的循环演示`} loading="lazy"/> : <p className="training-muted">返回此页后显示循环演示。</p> : videoReady && <video key={videoAsset.id} ref={videoRef} className="training-video lesson-video" src={videoAsset.url} crossOrigin="anonymous" controls playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { if (active && loop && hasRange) void playRange(); }} onLoadedMetadata={event => { const video = event.currentTarget; video.playbackRate = slow ? .5 : 1; if (hasRange && step.startSeconds !== null && step.startSeconds < video.duration) video.currentTime = step.startSeconds; }} onTimeUpdate={event => { const video = event.currentTarget; if (loop && hasRange && !video.paused && step.endSeconds !== null && step.startSeconds !== null && video.currentTime >= step.endSeconds) video.currentTime = step.startSeconds; }} onError={() => setError('片段暂时无法播放，请重新加载，或回到教学资料检查原片编码。')}/>}
    <div className="lesson-play-controls">
      {videoReady && <><button type="button" className="training-secondary" onClick={() => { if (showGif) setShowGif(false); else void playRange(); }} disabled={!active}><Play size={15}/>{showGif ? '查看原片' : hasRange ? '播放这一步' : '播放原片'}</button>{hasRange && <button type="button" className="training-text-button" aria-pressed={loop} onClick={() => setLoop(value => !value)}><Repeat size={15}/>{loop ? '循环片段' : '连续原片'}</button>}<button type="button" className="training-text-button" aria-pressed={slow} onClick={() => { const next = !slow; setSlow(next); if (videoRef.current) videoRef.current.playbackRate = next ? .5 : 1; }}>{slow ? '0.5 倍速' : '1 倍速'}</button></>}
      {gifReady && <button type="button" className="training-secondary" aria-pressed={showGif} onClick={() => setShowGif(value => !value)}>{showGif ? '收起 GIF' : '显示循环 GIF'}</button>}
      {hasRange && <span className="training-muted">{timestamp(step.startSeconds!)}–{timestamp(step.endSeconds!)}</span>}
    </div>
    {error && <div className="lesson-player-error"><p role="alert">{error}</p><button type="button" className="training-text-button" onClick={() => { setError(''); videoRef.current?.load(); }}>重新加载片段</button></div>}
  </div>;
}
