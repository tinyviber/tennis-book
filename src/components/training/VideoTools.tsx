'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { publicPath } from '@/lib/urls';
import { MAX_ANALYSIS_BYTES, MAX_ANALYSIS_FRAMES, MAX_FRAME_BYTES, type SelectedFrame, type TrainingAnalysis } from '@/lib/training-ai-types';
import './video-tools.css';

type Point = { x: number; y: number; visibility?: number };
const connections = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
function grab(video: HTMLVideoElement): HTMLCanvasElement {
  if (video.readyState < 2 || !video.videoWidth) throw new Error('请先加载并暂停录像，再选择当前帧。');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持画面截取，请继续手动复盘。');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}
export function VideoTools({ videoRef, stroke, coachNotes, aiConfigured, poseModelUrl, onAnalysis }: { videoRef: RefObject<HTMLVideoElement | null>; stroke: string; coachNotes: string; aiConfigured: boolean; poseModelUrl?: string; onAnalysis: (result: TrainingAnalysis) => void }) {
  const [frames, setFrames] = useState<SelectedFrame[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [poseBusy, setPoseBusy] = useState(false);
  const [pose, setPose] = useState('');
  const [error, setError] = useState('');
  const [poseNotice, setPoseNotice] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const poseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { workerRef.current?.terminate(); abortRef.current?.abort(); if (poseTimerRef.current) clearTimeout(poseTimerRef.current); }, []);
  function capture() {
    try {
      setError('');
      if (frames.length >= MAX_ANALYSIS_FRAMES) throw new Error('一次最多选择 6 帧，请先移除已有帧。');
      const video = videoRef.current;
      if (!video) throw new Error('请先上传并打开录像。');
      video.pause();
      if (frames.some(frame => Math.abs(frame.atSeconds - video.currentTime) < .05)) throw new Error('当前时间点已经选过，请移动播放位置。');
      const canvas = grab(video);
      let image = canvas.toDataURL('image/jpeg', .8);
      if ((image.length - 23) * .75 > MAX_FRAME_BYTES) image = canvas.toDataURL('image/jpeg', .5);
      if ((image.length - 23) * .75 > MAX_FRAME_BYTES) throw new Error('当前帧过大，请使用较小的录像。');
      setFrames(current => [...current, { atSeconds: video.currentTime, image }]); setConsent(false);
    } catch (error) { setError((error as Error).message); }
  }
  async function analyze() {
    setBusy(true); setError('');
    const controller = new AbortController(); abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const body = JSON.stringify({ frames, stroke, coachNotes: coachNotes.slice(0, 4000), consent });
      if (new TextEncoder().encode(body).length > MAX_ANALYSIS_BYTES) throw new Error('所选帧请求超过 3 MB，请减少帧数。');
      const response = await fetch(publicPath('/api/training/analyze/'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '分析失败，请手动复盘。');
      onAnalysis(data as TrainingAnalysis);
    } catch (error) { setError(controller.signal.aborted ? '分析已超时或取消，请重试。' : (error as Error).message); }
    finally { clearTimeout(timer); setBusy(false); abortRef.current = null; }
  }
  async function estimatePose() {
    setError(''); setPoseNotice(''); setPose('');
    try {
      const video = videoRef.current;
      if (!video) throw new Error('请先打开录像。');
      if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) throw new Error('此浏览器不支持后台姿态分析，请继续手动复盘。');
      video.pause();
      const atSeconds = video.currentTime;
      const canvas = grab(video);
      const bitmap = await createImageBitmap(canvas);
      setPoseBusy(true);
      workerRef.current?.terminate();
      const worker = new Worker(publicPath('/training-pose-worker.js')); workerRef.current = worker;
      const timer = setTimeout(() => { worker.terminate(); workerRef.current = null; setPoseBusy(false); setError('姿态模型加载超时，请检查网络或继续手动复盘。'); }, 45000); poseTimerRef.current = timer;
      worker.onmessage = event => {
        clearTimeout(timer); worker.terminate(); workerRef.current = null; setPoseBusy(false);
        if (event.data.error) { setError(event.data.error); return; }
        const points: Point[] = event.data.points;
        if (!points.length) { setPoseNotice('没有找到清晰的人体；请换一个全身入镜的时间点。'); return; }
        const context = canvas.getContext('2d')!;
        context.strokeStyle = '#a8e46e'; context.fillStyle = '#e6ffd0'; context.lineWidth = 3;
        const visible = (point?: Point) => point && (point.visibility ?? 0) >= .65;
        for (const [a,b] of connections) if (visible(points[a]) && visible(points[b])) { context.beginPath(); context.moveTo(points[a].x * canvas.width, points[a].y * canvas.height); context.lineTo(points[b].x * canvas.width, points[b].y * canvas.height); context.stroke(); }
        for (const point of points.slice(11)) if (visible(point)) { context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2); context.fill(); }
        setPose(canvas.toDataURL('image/jpeg', .85)); setPoseNotice(`当前帧 ${atSeconds.toFixed(2)} 秒的估计关键点。低可见度点已隐藏，仅辅助观察。`);
      };
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); workerRef.current = null; setPoseBusy(false); setError('姿态模型启动失败，请继续手动复盘。'); };
      worker.postMessage({ bitmap, assetBase: `${location.origin}${publicPath('/training-vision')}`, modelUrl: poseModelUrl ? new URL(poseModelUrl, location.origin).href : undefined }, [bitmap]);
    } catch (error) { setPoseBusy(false); setError((error as Error).message); }
  }
  return <section className="training-video-tools" aria-label="可选影像工具">
    <h3>选择证据帧</h3><p className="training-muted">暂停在准备、击球附近和随挥画面，再选 1–6 帧。静帧无法确定挥拍速度或精确触球时刻。</p>
    <button type="button" className="training-secondary" onClick={capture} disabled={busy}>选择当前帧</button>
    {!!frames.length && <div className="training-frame-grid">{frames.map((frame,index) => <figure key={frame.atSeconds}><img src={frame.image} alt={`已选录像帧 ${frame.atSeconds.toFixed(2)} 秒`}/><figcaption>{frame.atSeconds.toFixed(2)} 秒<button type="button" className="training-text-button" disabled={busy} onClick={() => { setFrames(current => current.filter((_,i) => i !== index)); setConsent(false); }} aria-label={`移除 ${frame.atSeconds.toFixed(2)} 秒帧`}>移除</button></figcaption></figure>)}</div>}
    <label className="training-check"><input type="checkbox" checked={consent} disabled={!aiConfigured || busy} onChange={event => setConsent(event.target.checked)}/><span>本次同意将所选帧和教练备注发送给 OpenAI 分析，可能产生 API 费用。原视频不会发送；关闭结果存储不代表服务商零留存。</span></label>
    <div className="training-actions"><button type="button" className="training-button" disabled={!aiConfigured || !frames.length || !consent || busy} onClick={analyze}>{busy ? '正在分析所选帧…' : '生成待确认建议'}</button>{busy && <button type="button" className="training-secondary" onClick={() => abortRef.current?.abort()}>取消分析</button>}</div>
    {!aiConfigured && <p className="training-muted">影像 AI 尚未配置。人工观察、教练校准和训练计划仍可使用。</p>}
    <details className="training-details"><summary>本地姿态参考 <small>可选 · 估计人体关键点</small></summary><p className="training-muted">点击后加载姿态模型；{poseModelUrl?.startsWith('/') ? '模型由本站提供' : '从配置的模型地址下载，默认是 Google'}。当前帧在浏览器后台计算，不上传录像。不识别球或球拍，也不生成动作分数。</p><button className="training-secondary" type="button" disabled={poseBusy} onClick={estimatePose}>{poseBusy ? '正在加载并计算…' : '估计当前帧关键点'}</button>{poseNotice && <p className="training-muted" role="status">{poseNotice}</p>}{pose && <img src={pose} className="training-pose-preview" alt="当前帧上的估计人体关键点"/>}</details>
    {error && <p className="training-feedback" data-kind="error" role="alert">{error}</p>}
  </section>;
}
