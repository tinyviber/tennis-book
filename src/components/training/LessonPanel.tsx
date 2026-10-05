'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Camera, Download, Pin, Plus, Save, Trash2, WandSparkles } from 'lucide-react';
import type { MediaAsset, TeachingLesson, TeachingStep, TrainingCapabilities, TrainingState } from '@/lib/training-types';
import type { SelectedFrame } from '@/lib/training-ai-types';
import { MAX_ANALYSIS_BYTES, MAX_ANALYSIS_FRAMES, MAX_FRAME_BYTES } from '@/lib/training-ai-types';
import { parseTeachingDraft, validateTeachingLesson, type LessonAnalysis } from '@/lib/training-lessons';
import { createTeachingGif } from './lesson-gif';
import { LessonPlayer } from './LessonPlayer';
import { downloadJson, numberOrNull, strokeLabel, timestamp, trainingRequest, type LocalDraft } from './client';

type Props = { state: TrainingState; media: MediaAsset[]; capabilities: TrainingCapabilities; onSave: (state?: TrainingState) => Promise<boolean>; uploadMedia: (file: File) => Promise<MediaAsset>; active: boolean; onDraftChange: (draft: LocalDraft) => void };
const categories = { ...strokeLabel, conditioning: '体能', other: '其他' };
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const SOURCE_TEXT_LIMIT = 30000;

function newLesson(): TeachingLesson {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '', category: 'footwork', sourceKind: 'notes', sourceUrl: null, sourceText: '', mediaId: null, durationSeconds: null, summary: '', steps: [], createdAt: now, updatedAt: now };
}
function newStep(): TeachingStep {
  return { id: crypto.randomUUID(), title: '新步骤', cue: '', instructions: '', repetitions: '', sourceQuote: '', evidenceAtSeconds: null, startSeconds: null, endSeconds: null, gifMediaId: null, origin: 'manual', confirmed: true };
}
function cleanFileTitle(value: string) { return (value.replace(/[\x00-\x1f\x7f/\\]/g, '').trim() || '网球教学').slice(0, 90); }
function frameImage(video: HTMLVideoElement): string {
  if (video.readyState < 2 || !video.videoWidth) throw new Error('请先加载录像，再选择画面。');
  const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法截取画面。仍可以粘贴字幕并手动整理。');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  let image = canvas.toDataURL('image/jpeg', .75);
  if ((image.length - 23) * .75 > MAX_FRAME_BYTES) image = canvas.toDataURL('image/jpeg', .45);
  if ((image.length - 23) * .75 > MAX_FRAME_BYTES) throw new Error('画面超过 350 KB，请换一段较小的录像。');
  return image;
}
function seekFrame(video: HTMLVideoElement, seconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('已取消画面选择。'));
  if (Math.abs(video.currentTime - seconds) < .015 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); signal.removeEventListener('abort', cancelled); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('无法读取这一帧，请手动选择画面。')); };
    const cancelled = () => { cleanup(); reject(new Error('已取消画面选择。')); };
    const timer = setTimeout(fail, 12000);
    video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', fail, { once: true }); signal.addEventListener('abort', cancelled, { once: true });
    video.currentTime = seconds;
  });
}

export function LessonPanel({ state, media, capabilities, onSave, uploadMedia, active, onDraftChange }: Props) {
  const [draft, setDraft] = useState<TeachingLesson | null>(null);
  const [frames, setFrames] = useState<SelectedFrame[]>([]);
  const [pending, setPending] = useState<LessonAnalysis | null>(null);
  const [importText, setImportText] = useState('');
  const [consent, setConsent] = useState(false);
  const [operation, setOperation] = useState<'upload' | 'frames' | 'ai' | 'gif' | 'download' | 'save' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const saved = state.lessons.find(lesson => lesson.id === draft?.id);
  const dirty = !!draft && JSON.stringify(saved ?? null) !== JSON.stringify(draft);
  const hasPending = !!pending || !!importText.trim() || frames.length > 0;
  const locked = operation !== null;
  const asset = media.find(item => item.id === draft?.mediaId && item.status === 'ready');

  useEffect(() => { onDraftChange({ dirty: dirty || hasPending || locked, value: { draft, pending, importText, frames, consent, operation } }); }, [draft, pending, importText, frames, consent, operation, dirty, hasPending, locked, onDraftChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abortRef.current?.abort(); videoRef.current?.pause(); }; }, []);
  useEffect(() => { if (!active) { videoRef.current?.pause(); abortRef.current?.abort(); } }, [active]);
  useEffect(() => {
    const pause = () => { if (document.hidden) videoRef.current?.pause(); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);

  function choose(lesson: TeachingLesson | null) {
    if (locked) return;
    if ((dirty || hasPending) && !window.confirm('这条教学资料还有未保存的输入。切换会丢失本条草稿，继续？')) return;
    videoRef.current?.pause();
    setDraft(lesson ? structuredClone(lesson) : newLesson()); setFrames([]); setPending(null); setImportText(''); setConsent(false); setError(''); setNotice('');
  }
  function patch(value: Partial<TeachingLesson>) {
    if (value.sourceText !== undefined && draft?.steps.some(step => step.sourceQuote && !value.sourceText!.includes(step.sourceQuote))) setNotice('正文已变更，不再匹配的来源原句已清除。这些步骤文字保留，请补充出处并重新核对。');
    setDraft(current => {
      if (!current) return current;
      const sourceChanged = value.sourceText !== undefined && value.sourceText !== current.sourceText;
      const steps = sourceChanged ? current.steps.map(step => {
        const staleQuote = !!step.sourceQuote && !value.sourceText!.includes(step.sourceQuote);
        return { ...step, ...(staleQuote ? { sourceQuote: '', ...(step.evidenceAtSeconds === null ? { origin: 'manual' as const } : {}) } : {}), ...(staleQuote || step.origin !== 'manual' ? { confirmed: false } : {}) };
      }) : current.steps;
      return { ...current, ...value, updatedAt: new Date().toISOString(), ...(sourceChanged ? { steps } : {}) };
    });
    if (value.sourceText !== undefined || value.mediaId !== undefined || value.category !== undefined) { setPending(null); setConsent(false); }
  }
  function patchStep(id: string, value: Partial<TeachingStep>) {
    setDraft(current => {
      if (!current) return current;
      return { ...current, updatedAt: new Date().toISOString(), steps: current.steps.map(step => {
        if (step.id !== id) return step;
        const changedRange = (value.startSeconds !== undefined && value.startSeconds !== step.startSeconds) || (value.endSeconds !== undefined && value.endSeconds !== step.endSeconds);
        const contentChanged = Object.keys(value).some(key => !['confirmed', 'gifMediaId'].includes(key));
        return { ...step, ...value, ...(changedRange ? { gifMediaId: null } : {}), ...(contentChanged && step.origin !== 'manual' ? { confirmed: false } : {}) };
      }) };
    });
  }
  async function readSource(file: File | undefined) {
    if (!file || !draft) return;
    setError('');
    try {
      if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('文本文件须在 256 KB 以内。请先截取本次要学的部分。');
      const text = (await file.text()).replace(/^\uFEFF/, '');
      if (text.length > SOURCE_TEXT_LIMIT) throw new Error('正文最多 30,000 字符，请分成几条教学资料。');
      patch({ sourceText: text }); setNotice('正文已读入本页草稿，保存教学资料后才会入库。');
    } catch (error) { setError((error as Error).message); }
  }
  async function upload(file: File | undefined) {
    if (!file || !draft) return;
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) { setError('请选择 MP4、MOV 或 WebM 教学短片。'); return; }
    setOperation('upload'); setError(''); setNotice(''); videoRef.current?.pause();
    try {
      const uploaded = await uploadMedia(file);
      if (!alive.current) return;
      patch({ mediaId: uploaded.id, durationSeconds: null, sourceKind: 'video', steps: draft.steps.map(step => ({ ...step, startSeconds: null, endSeconds: null, evidenceAtSeconds: null, gifMediaId: null, origin: step.origin === 'ai' && !step.sourceQuote ? 'manual' : step.origin, confirmed: false })) });
      setFrames([]); setPending(null); setConsent(false); setNotice('原片已上传。旧片段、GIF 和画面证据关联已清除；步骤文字保留，请重新核对并保存。');
    } catch (error) { if (alive.current) setError((error as Error).message); }
    finally { if (alive.current) setOperation(null); }
  }
  function capture() {
    try {
      setError('');
      if (frames.length >= MAX_ANALYSIS_FRAMES) throw new Error('一次最多选择 6 帧。请先移除已有画面。');
      const video = videoRef.current;
      if (!video) throw new Error('请先上传并加载教学录像。');
      video.pause();
      if (frames.some(frame => Math.abs(frame.atSeconds - video.currentTime) < .05)) throw new Error('这个时间点已经选过，请移动播放位置。');
      setFrames(current => [...current, { atSeconds: video.currentTime, image: frameImage(video) }]); setConsent(false); setPending(null);
    } catch (error) { setError((error as Error).message); }
  }
  async function sampleFrames() {
    const video = videoRef.current;
    if (!video || !draft?.durationSeconds) { setError('请先等原片时长读取完成。'); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setOperation('frames'); setError(''); setProgress(0); setPending(null); video.pause();
    const before = video.currentTime;
    try {
      const selected: SelectedFrame[] = [];
      for (let index = 0; index < MAX_ANALYSIS_FRAMES; index++) {
        const target = Math.min(draft.durationSeconds - .01, draft.durationSeconds * (index + .5) / MAX_ANALYSIS_FRAMES);
        await seekFrame(video, Math.max(0, target), controller.signal);
        selected.push({ atSeconds: video.currentTime, image: frameImage(video) }); setProgress((index + 1) / MAX_ANALYSIS_FRAMES);
      }
      if (!controller.signal.aborted && alive.current) { setFrames(selected); setConsent(false); setNotice('已均匀选出 6 帧。请检查并移除无关画面；这些画面不包含视频声音。'); }
    } catch (error) { if (alive.current) setError((error as Error).message); }
    finally { if (alive.current) { video.currentTime = before; setOperation(null); } abortRef.current = null; }
  }
  async function analyze() {
    if (!draft) return;
    const controller = new AbortController(); abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 55000);
    setOperation('ai'); setError(''); setNotice('');
    try {
      const body = JSON.stringify({ title: draft.title, category: draft.category, sourceText: draft.sourceText, durationSeconds: draft.durationSeconds, frames, consent });
      if (new TextEncoder().encode(body).length > MAX_ANALYSIS_BYTES) throw new Error('文字与画面合计超过 3 MB，请减少选帧。');
      const result = await trainingRequest<LessonAnalysis>('/api/training/lessons/analyze/', { method: 'POST', body, signal: controller.signal });
      if (alive.current && !controller.signal.aborted) setPending(result);
    } catch (error) { if (alive.current) setError(controller.signal.aborted ? '整理已取消或超时，原资料仍保留。' : (error as Error).message); }
    finally { clearTimeout(timer); abortRef.current = null; if (alive.current) setOperation(null); }
  }
  function previewImport(value = importText) {
    if (!draft) return;
    setError('');
    try { setPending(parseTeachingDraft(JSON.parse(value), draft)); setNotice('已校验 JSON 草稿。检查下方预览，采纳后仍需保存。'); }
    catch (error) { setError((error as Error).message || '无法读取 JSON。'); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('草稿文件须在 256 KB 以内。');
      const text = await file.text(); setImportText(text); previewImport(text);
    } catch (error) { setError((error as Error).message); }
  }
  function adoptPending() {
    if (!draft || !pending) return;
    if (draft.steps.length && !window.confirm('采纳会替换本条教学资料现有的步骤。原资料文字保留，继续？')) return;
    patch({ summary: pending.summary, steps: pending.steps.map(step => ({ ...step, confirmed: false, gifMediaId: null })) });
    setPending(null); setImportText(''); setFrames([]); setConsent(false); setNotice('草稿已填入。请核对每步的文字、出处和时间段，再保存。');
  }
  async function gif(step: TeachingStep) {
    const video = videoRef.current;
    if (!video || !draft || step.startSeconds === null || step.endSeconds === null) { setError('先关联原片，并填写这一步的起止秒数。'); return; }
    if (step.endSeconds - step.startSeconds > 6) { setError('GIF 最长 6 秒。请缩短这个步骤的片段；较长片段仍可循环原片。'); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setOperation('gif'); setProgress(0); setError(''); setNotice('');
    try {
      const blob = await createTeachingGif(video, step.startSeconds, step.endSeconds, { signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) throw new Error('GIF 生成已取消。');
      const uploaded = await uploadMedia(new File([blob], `${cleanFileTitle(draft.title)}-${cleanFileTitle(step.title)}.gif`.slice(0, 175), { type: 'image/gif' }));
      if (alive.current) { patchStep(step.id, { gifMediaId: uploaded.id }); setNotice('GIF 已生成并上传。保存教学资料后，今日训练也能显示它。'); }
    } catch (error) { if (alive.current) setError(controller.signal.aborted ? 'GIF 生成已取消，仍可以循环原片。' : (error as Error).message); }
    finally { abortRef.current = null; if (alive.current) setOperation(null); }
  }
  async function save(pin = false) {
    if (!draft) return;
    if (!draft.title.trim()) { setError('请填写教学资料标题。'); return; }
    if (draft.sourceUrl && !/^https?:\/\//i.test(draft.sourceUrl)) { setError('来源链接须以 http:// 或 https:// 开头。'); return; }
    if (draft.steps.some(step => !step.title.trim())) { setError('每个步骤都需要一个标题。'); return; }
    let normalised: TeachingLesson;
    try { normalised = validateTeachingLesson({ ...draft, title: draft.title.trim(), sourceUrl: draft.sourceUrl?.trim() || null, updatedAt: new Date().toISOString() }); }
    catch (error) { setError((error as Error).message); return; }
    const lessons = state.lessons.some(lesson => lesson.id === normalised.id) ? state.lessons.map(lesson => lesson.id === normalised.id ? normalised : lesson) : [...state.lessons, normalised];
    setOperation('save'); setError('');
    try {
      if (await onSave({ ...state, lessons, pinnedLessonId: pin ? normalised.id : state.pinnedLessonId })) { setDraft(normalised); setNotice(pin ? '教学资料已保存并固定到今日训练。' : '教学资料已保存。'); }
    } finally { if (alive.current) setOperation(null); }
  }
  async function remove() {
    if (!draft || !saved || !window.confirm(`删除“${draft.title}”？教学文字将移除，原片和 GIF 文件保留。`)) return;
    setOperation('save');
    try {
      if (await onSave({ ...state, lessons: state.lessons.filter(lesson => lesson.id !== draft.id), pinnedLessonId: state.pinnedLessonId === draft.id ? null : state.pinnedLessonId })) { setDraft(null); setPending(null); setFrames([]); setImportText(''); setNotice('教学资料已删除，素材仍保留。'); }
    } finally { if (alive.current) setOperation(null); }
  }
  function exportCard() {
    if (!draft) return;
    downloadJson({ format: 'tennis-teaching-draft', version: 1, title: draft.title, sourceUrl: draft.sourceUrl, summary: draft.summary, steps: draft.steps.map(({ id: _id, gifMediaId: _gif, origin: _origin, confirmed: _confirmed, ...step }) => step), limitations: [], insufficientEvidence: false }, `${cleanFileTitle(draft.title)}-教学卡.json`);
  }
  async function downloadGif(step: TeachingStep) {
    const gifAsset = media.find(item => item.id === step.gifMediaId && item.contentType === 'image/gif' && item.status === 'ready');
    if (!gifAsset) { setError('GIF 素材暂不可用，请重新生成。'); return; }
    if (gifAsset.size > 4 * 1024 * 1024) { setError('GIF 超过 4 MB，请重新生成较短的片段。'); return; }
    const controller = new AbortController(); abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 30000);
    setOperation('download'); setError('');
    try {
      const response = await fetch(gifAsset.url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('暂时无法下载 GIF，请检查登录状态或重新加载资料。');
      const blob = await response.blob();
      if (blob.size > 4 * 1024 * 1024 || blob.size === 0) throw new Error('GIF 下载大小不正确，请重新生成。');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${cleanFileTitle(step.title)}.gif`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (alive.current) setError(controller.signal.aborted ? 'GIF 下载已取消或超时。' : (error as Error).message); }
    finally { clearTimeout(timer); abortRef.current = null; if (alive.current) setOperation(null); }
  }
  function exportPrompt() {
    if (!draft) return;
    const prompt = `请将下方我提供的网球教学资料整理成训练时可以顺手看的中文步骤。只依据正文，不要声称读过来源链接。每步包含一个简短 cue、instructions、repetitions 和正文原句 sourceQuote。无法从文字确认的动作或训练量请明确写待核对；不要给医疗诊断。视频精确时间未知时 startSeconds、endSeconds、evidenceAtSeconds 都填 null。最多 6 步。返回纯 JSON：\n${JSON.stringify({ format: 'tennis-teaching-draft', version: 1, summary: '简短摘要', steps: [{ title: '步骤标题', cue: '一个提示', instructions: '练法', repetitions: '资料明确给出的练习安排，未知留空', sourceQuote: '实际正文中的原句', evidenceAtSeconds: null, startSeconds: null, endSeconds: null }], limitations: ['无法确认的信息'], insufficientEvidence: false }, null, 2)}\n\n资料标题：${draft.title}\n来源链接（仅供记录）：${draft.sourceUrl || '未提供'}\n正文／字幕：\n${draft.sourceText || '请在此处添加正文或字幕后再发给 AI。'}`;
    const url = URL.createObjectURL(new Blob([prompt], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${cleanFileTitle(draft.title)}-AI整理提示.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <section className="training-panel"><div className="training-section-head"><div><h2>把好教程变成顺手的训练卡</h2><p>保存文章、字幕或教学短片，拆成几步，再把要练的内容固定到今日训练。</p></div><button type="button" className="training-secondary" disabled={locked} onClick={() => choose(null)}><Plus size={16}/>添加教学资料</button></div>
      <div className="lesson-library">{[...state.lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(lesson => <button type="button" key={lesson.id} disabled={locked} aria-pressed={draft?.id === lesson.id} onClick={() => choose(lesson)}><span><BookOpen size={17}/><strong>{lesson.title}</strong>{state.pinnedLessonId === lesson.id && <Pin size={14}/>}</span><small>{categories[lesson.category]} · {lesson.steps.length} 步{lesson.mediaId ? ' · 有视频' : ''}</small></button>)}</div>
      {!draft && <div className="training-empty"><BookOpen size={25}/><p>看到分腿垫步或其他好教程时，把正文、字幕或短片放进来。训练时按步骤看，省去来回拖视频。</p><button type="button" className="training-button" onClick={() => choose(null)}>添加第一条教学资料</button></div>}
    </section>
    {error && <p className="training-feedback" data-kind="error" role="alert">{error}</p>}{notice && <p className="training-feedback" data-kind="success" role="status">{notice}</p>}
    {operation && <div className="lesson-operation" role="status"><span>{operation === 'upload' ? '正在上传原片…' : operation === 'ai' ? '正在整理教学草稿…' : operation === 'gif' ? `正在生成并保存 GIF… ${Math.round(progress * 100)}%` : operation === 'frames' ? `正在选择画面… ${Math.round(progress * 100)}%` : '正在保存教学资料…'}</span>{['ai', 'gif', 'frames'].includes(operation) && <button type="button" className="training-text-button" onClick={() => abortRef.current?.abort()}>取消</button>}</div>}
    {draft && <fieldset className="lesson-editor-fieldset" disabled={locked}>
      <section className="training-panel"><h2>来源与正文</h2><div className="training-grid"><label className="training-label">标题<input value={draft.title} maxLength={200} onChange={event => patch({ title: event.target.value })} placeholder="例如：分腿垫步与第一步"/></label><label className="training-label">训练项目<select value={draft.category} onChange={event => patch({ category: event.target.value as TeachingLesson['category'] })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="training-label">资料类型<select value={draft.sourceKind} onChange={event => patch({ sourceKind: event.target.value as TeachingLesson['sourceKind'] })}><option value="notes">自己的笔记</option><option value="article">文章</option><option value="video">视频教学</option></select></label><label className="training-label">来源链接<input type="url" value={draft.sourceUrl ?? ''} maxLength={2000} onChange={event => patch({ sourceUrl: event.target.value || null })} placeholder="https://…"/></label><label className="training-label training-full">文章正文、字幕或你的笔记<textarea className="lesson-source-text" value={draft.sourceText} maxLength={SOURCE_TEXT_LIMIT} onChange={event => patch({ sourceText: event.target.value })} placeholder="粘贴本次想学的正文、SRT／VTT 字幕，或听视频时写下的要点。只保存链接时，系统把它作为收藏。"/><small>{draft.sourceText.length.toLocaleString()} / 30,000 字符；链接本身不会自动读取正文或声音。</small></label><label className="training-label training-full">从文件读入正文<input type="file" accept=".txt,.md,.srt,.vtt,text/plain,text/markdown,text/vtt" onChange={event => { void readSource(event.target.files?.[0]); event.target.value = ''; }}/><small>TXT、Markdown、SRT、VTT，最多 256 KB；读取会替换当前正文。</small></label></div>{draft.sourceUrl && /^https?:\/\//i.test(draft.sourceUrl) && <a className="training-source" href={draft.sourceUrl} target="_blank" rel="noreferrer">打开原始来源<ArrowUpRight size={13}/></a>}</section>
      <section className="training-panel"><h2>教学原片与画面</h2><label className="training-label">上传教学短片<input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/></label><p className="training-muted">原片最多 {Math.floor(capabilities.maxMediaBytes / 1024 / 1024)} MB。保留原片，按步骤截取短片；不自动下载外部平台视频。</p>
        {asset?.contentType.startsWith('video/') ? <><p className="training-muted">{asset.name}{draft.durationSeconds !== null ? ` · ${timestamp(draft.durationSeconds)}` : ''}</p><video key={asset.id} ref={videoRef} className="training-video" src={asset.url} crossOrigin="anonymous" controls={!locked} playsInline preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0 && duration <= 86400 && duration !== draft.durationSeconds) patch({ durationSeconds: duration, steps: draft.steps.map(step => step.endSeconds !== null && step.endSeconds > duration ? { ...step, startSeconds: null, endSeconds: null, gifMediaId: null, confirmed: false } : step) }); }} onError={() => setError('原片暂时无法读取。请重新加载；iPhone 视频可先导出 H.264 MP4。')}/><div className="training-actions"><button type="button" className="training-secondary" onClick={capture}><Camera size={15}/>选择当前帧</button><button type="button" className="training-secondary" disabled={draft.durationSeconds === null} onClick={() => void sampleFrames()}>均匀选取 6 帧</button><button type="button" className="training-text-button" onClick={() => { setError(''); videoRef.current?.load(); }}>重新加载原片</button></div><p className="training-muted">选帧供 AI 看画面，最多 6 帧。口头教学请补字幕或笔记；时间段和动作仍需核对。</p></> : draft.mediaId ? <p className="training-muted">原片缺失，请重新上传关联。已有教学文字保留。</p> : <p className="training-muted">文章可以直接整理；视频教学上传原片后，可选画面并生成循环片段。</p>}
        {frames.length > 0 && <div className="lesson-frames">{frames.map((frame, index) => <figure key={`${frame.atSeconds}:${index}`}><img src={frame.image} alt={`待分析画面 ${timestamp(frame.atSeconds)}`}/><figcaption>{frame.atSeconds.toFixed(2)} 秒<button type="button" className="training-text-button" onClick={() => { setFrames(current => current.filter((_, position) => position !== index)); setConsent(false); setPending(null); }} aria-label={`移除第 ${index + 1} 帧`}>移除</button></figcaption></figure>)}</div>}
      </section>
      <section className="training-panel training-soft"><h2>整理成教学草稿</h2><p className="training-muted">AI 只使用你提供的正文和所选画面。整理后先检查出处，再放进训练卡。</p><label className="training-checkbox"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/>同意将这条正文和所选画面发送给已配置的 AI 服务</label><div className="training-actions"><button type="button" className="training-button" disabled={!capabilities.aiConfigured || !consent || (!draft.sourceText.trim() && !frames.length)} onClick={() => void analyze()}><WandSparkles size={16}/>AI 整理步骤</button><button type="button" className="training-secondary" onClick={exportPrompt}><Download size={15}/>导出给其他 AI 的提示</button></div>{!capabilities.aiConfigured && <p className="training-muted">本站 AI 尚未配置。可以手动加步骤，或把提示和资料交给你常用的 AI，再导入 JSON 草稿。</p>}
        <details className="lesson-import"><summary>导入其他 AI 整理的 JSON</summary><p className="training-muted">使用导出的提示约定格式。先保留对应正文，系统会检查原句、时间段和字段。</p><label className="training-label">粘贴 JSON<textarea value={importText} maxLength={MAX_TEXT_FILE_BYTES} onChange={event => { setImportText(event.target.value); setPending(null); }} placeholder={'{"format":"tennis-teaching-draft","version":1,"summary":"…","steps":[…]}'}/></label><div className="training-actions"><button type="button" className="training-secondary" disabled={!importText.trim()} onClick={() => previewImport()}>校验并预览</button><label className="training-label">或选择 JSON 文件<input type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }}/></label></div></details>
      </section>
      {pending && <section className="training-panel lesson-pending"><div className="training-section-head"><div><h2>待检查的整理结果</h2><p>{pending.insufficientEvidence ? '资料不足，这份草稿需要补充来源并核对。' : '这份结果还没有保存为训练卡。'}</p></div><span className="training-badge">草稿</span></div><p>{pending.summary}</p><ol>{pending.steps.map(step => <li key={step.id}><strong>{step.title}</strong><p>{step.cue}<br/>{step.instructions}</p>{step.repetitions && <p>{step.repetitions}</p>}{step.sourceQuote && <blockquote>{step.sourceQuote}</blockquote>}{step.evidenceAtSeconds !== null && <p className="training-muted">所选画面证据：{step.evidenceAtSeconds.toFixed(2)} 秒</p>}{step.startSeconds !== null && step.endSeconds !== null && <p className="training-muted">建议片段：{step.startSeconds.toFixed(2)}–{step.endSeconds.toFixed(2)} 秒，请播放核对。</p>}</li>)}</ol>{pending.limitations.length > 0 && <ul className="training-muted">{pending.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}<div className="training-actions"><button type="button" className="training-button" onClick={adoptPending}>填入这份步骤草稿</button><button type="button" className="training-text-button" onClick={() => setPending(null)}>关闭预览</button></div></section>}
      <section className="training-panel"><div className="training-section-head"><div><h2>训练卡与动作分解</h2><p>把每步写成你站上球场后能马上使用的提示。GIF 生成会在本机浏览器完成。</p></div><button type="button" className="training-secondary" disabled={draft.steps.length >= 24} onClick={() => patch({ steps: [...draft.steps, newStep()] })}><Plus size={15}/>手动加一步</button></div><label className="training-label">简短摘要<textarea value={draft.summary} maxLength={3000} onChange={event => patch({ summary: event.target.value })} placeholder="这条资料解决什么问题，适合什么时候练"/></label>
        {draft.steps.map((step, index) => <article className="lesson-step-editor" key={step.id}><div className="lesson-step-head"><h3>第 {index + 1} 步</h3><span className="training-badge">{step.origin === 'manual' ? '手动' : step.origin === 'ai' ? 'AI 草稿' : '导入草稿'}</span><div className="lesson-step-order"><button type="button" className="training-text-button" disabled={index === 0} onClick={() => { const steps = [...draft.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; patch({ steps }); }} aria-label={`上移第 ${index + 1} 步`}>上移</button><button type="button" className="training-text-button" disabled={index === draft.steps.length - 1} onClick={() => { const steps = [...draft.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; patch({ steps }); }} aria-label={`下移第 ${index + 1} 步`}>下移</button><button type="button" className="training-text-button" onClick={() => patch({ steps: draft.steps.filter(item => item.id !== step.id) })} aria-label={`删除第 ${index + 1} 步`}><Trash2 size={15}/></button></div></div><div className="training-grid"><label className="training-label">步骤标题<input maxLength={200} value={step.title} onChange={event => patchStep(step.id, { title: event.target.value })}/></label><label className="training-label">一个动作提示<input maxLength={500} value={step.cue} onChange={event => patchStep(step.id, { cue: event.target.value })} placeholder="例如：轻落地，再向球侧启动"/></label><label className="training-label training-full">怎样练<textarea maxLength={3000} value={step.instructions} onChange={event => patchStep(step.id, { instructions: event.target.value })}/></label><label className="training-label training-full">组次／时长／练习安排<input maxLength={500} value={step.repetitions} onChange={event => patchStep(step.id, { repetitions: event.target.value })} placeholder="来源未说明时留空，按教练建议补充"/></label><label className="training-label training-full">来源原句<textarea maxLength={2000} value={step.sourceQuote} onChange={event => patchStep(step.id, { sourceQuote: event.target.value })} placeholder="复制正文中支持这一步的原句"/></label>{asset?.contentType.startsWith('video/') && <><label className="training-label">片段开始（秒）<input type="number" min="0" max={draft.durationSeconds ?? undefined} step="0.01" value={step.startSeconds ?? ''} onChange={event => patchStep(step.id, { startSeconds: numberOrNull(event.target.value) })}/></label><label className="training-label">片段结束（秒）<input type="number" min="0" max={draft.durationSeconds ?? undefined} step="0.01" value={step.endSeconds ?? ''} onChange={event => patchStep(step.id, { endSeconds: numberOrNull(event.target.value) })}/></label><div className="training-actions training-full"><button type="button" className="training-text-button" onClick={() => patchStep(step.id, { startSeconds: Number((videoRef.current?.currentTime ?? 0).toFixed(2)) })}>用原片当前位置设为开始</button><button type="button" className="training-text-button" onClick={() => patchStep(step.id, { endSeconds: Number((videoRef.current?.currentTime ?? 0).toFixed(2)) })}>设为结束</button><button type="button" className="training-secondary" disabled={!step.confirmed || step.startSeconds === null || step.endSeconds === null || step.endSeconds <= step.startSeconds || step.endSeconds - step.startSeconds > 6} onClick={() => void gif(step)}>{step.gifMediaId ? '重新生成 GIF' : '生成并保存 GIF'}</button></div><p className="training-muted training-full">GIF 最长 6 秒、宽边 360 像素、每秒 8 帧。先核对片段，再生成；较长步骤可直接循环原片。</p></>}</div>{step.evidenceAtSeconds !== null && <p className="training-muted">画面证据时间：{step.evidenceAtSeconds.toFixed(2)} 秒。静帧不能确认完整动作节奏。</p>}<label className="training-checkbox"><input type="checkbox" checked={step.confirmed} onChange={event => patchStep(step.id, { confirmed: event.target.checked })}/>已核对这一步的文字、出处和片段</label><LessonPlayer key={`${step.id}:${step.gifMediaId ?? 'source'}`} step={step} videoAsset={asset} gifAsset={media.find(item => item.id === step.gifMediaId)} active={active && !locked}/></article>)}
        {!draft.steps.length && <p className="training-muted">还没有动作步骤。手动加一步，或先整理 AI 草稿。</p>}
      </section>
      <section className="training-panel lesson-save-panel"><div className="training-actions"><button type="button" className="training-button" onClick={() => void save(true)}><Pin size={16}/>保存并固定到今日训练</button><button type="button" className="training-secondary" onClick={() => void save()}><Save size={15}/>保存教学资料</button><button type="button" className="training-text-button" onClick={exportCard}><Download size={15}/>导出教学卡 JSON</button>{saved && <button type="button" className="training-text-button" onClick={() => void remove()}><Trash2 size={15}/>删除资料</button>}</div><p className="training-muted">今日训练显示已核对的步骤。原片与 GIF 只关联到资料，不会因为删除教学卡而移除。</p>{dirty && <p className="training-muted">教学资料还有未保存的输入；上方 AI 预览需先填入步骤草稿。</p>}</section>
    </fieldset>}
  </>;
}
