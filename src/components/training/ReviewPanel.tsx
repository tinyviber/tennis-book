'use client';
import { useEffect, useRef, useState } from 'react';
import type { MediaAsset, Observation, Review, TrainingCapabilities, TrainingState } from '@/lib/training-types';
import type { TrainingAnalysis } from '@/lib/training-ai-types';
import { VideoTools } from './VideoTools';
import { strokeLabel, timestamp } from './client';
import type { LocalDraft } from './client';

type Props = { state: TrainingState; media: MediaAsset[]; today: string; capabilities: TrainingCapabilities; onChange: (state: TrainingState) => void; onSave: (state?: TrainingState) => Promise<boolean>; uploadMedia: (file: File) => Promise<MediaAsset>; active: boolean; onDraftChange: (draft: LocalDraft) => void };
function newReview(today: string): Review {
  return { id: crypto.randomUUID(), date: today, title: '正手试练', stroke: 'forehand', feed: 'machine', camera: 'side', conditions: '', mediaId: null, durationSeconds: null, observations: [], coachRevisions: [], cue: '', drill: '', successMetric: '', previousReviewId: null };
}
export function ReviewPanel({ state, media, today, capabilities, onSave, uploadMedia, onDraftChange }: Props) {
  const [draft, setDraft] = useState<Review | null>(null);
  const [time, setTime] = useState('0');
  const [observation, setObservation] = useState('');
  const [kind, setKind] = useState<Observation['kind']>('visible');
  const [coachNote, setCoachNote] = useState('');
  const [pending, setPending] = useState<TrainingAnalysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const saved = state.reviews.find(review => review.id === draft?.id);
  const dirty = draft !== null && JSON.stringify(saved ?? null) !== JSON.stringify(draft);
  useEffect(() => { onDraftChange({ dirty: dirty || !!coachNote || !!observation, value: { draft, coachNote, observation, time, kind, pending } }); }, [draft, coachNote, observation, time, kind, pending, dirty, onDraftChange]);
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  function choose(review: Review | null) {
    if (busy) return;
    if ((dirty || coachNote || observation) && !window.confirm('本条复盘还有未保存的输入，切换会丢失。继续？')) return;
    setDraft(review ? structuredClone(review) : newReview(today)); setPending(null); setError(''); setCoachNote(''); setObservation(''); setTime('0'); setKind('visible');
  }
  function patch(value: Partial<Review>) { setDraft(current => current ? { ...current, ...value } : current); }
  async function upload(file: File | undefined) {
    if (!file || !draft) return;
    setBusy(true); setError('');
    try {
      const asset = await uploadMedia(file);
      patch({ mediaId: asset.id, durationSeconds: null }); setPending(null);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  function addObservation() {
    const seconds = Number(time);
    if (!draft || !observation.trim()) return;
    if (!Number.isFinite(seconds) || seconds < 0 || (draft.durationSeconds !== null && seconds > draft.durationSeconds)) { setError('观察时间点须在录像范围内。'); return; }
    patch({ observations: [...draft.observations, { id: crypto.randomUUID(), atSeconds: seconds, kind, text: observation.trim(), source: 'self', confidence: kind === 'visible' ? 'medium' : 'low' }] }); setObservation(''); setError('');
  }
  function seek(atSeconds: number) { if (videoRef.current) { videoRef.current.currentTime = atSeconds; videoRef.current.pause(); } }
  async function save(asTask = false) {
    if (!draft) return;
    if (!draft.title.trim() || (asTask && (!draft.cue.trim() || !draft.drill.trim() || !draft.successMetric.trim()))) { setError(asTask ? '请补齐一个提示、下次练法和复测标准。' : '请填写复盘标题。'); return; }
    setError('');
    const reviews = state.reviews.some(review => review.id === draft.id) ? state.reviews.map(review => review.id === draft.id ? draft : review) : [...state.reviews, draft];
    const currentTask = asTask ? { id: crypto.randomUUID(), reviewId: draft.id, cue: draft.cue, drill: draft.drill, successMetric: draft.successMetric, sourceCardId: null, createdAt: new Date().toISOString(), status: 'active' as const } : state.currentTask;
    await onSave({ ...state, reviews, currentTask });
  }
  const asset = media.find(asset => asset.id === draft?.mediaId);
  const previous = state.reviews.find(review => review.id === draft?.previousReviewId);
  const differences = previous && draft ? [['项目', previous.stroke, draft.stroke], ['来球', previous.feed, draft.feed], ['机位', previous.camera, draft.camera], ['练习条件', previous.conditions, draft.conditions], ['复测标准', previous.successMetric, draft.successMetric]].filter(([,before,after]) => before !== after).map(([label]) => label) : [];
  return <>
    <section className="training-panel"><div className="training-section-head"><div><h2>录像与复盘</h2><p>短片保留原样；把画面证据、解释和下一次任务分别记录。</p></div><button disabled={busy} className="training-secondary" onClick={() => choose(null)}>新建复盘</button></div>
      <div className="training-review-list">{[...state.reviews].reverse().map(review => <button disabled={busy} key={review.id} aria-pressed={draft?.id === review.id} onClick={() => choose(review)}><strong>{review.title}</strong><small>{review.date} · {strokeLabel[review.stroke]}</small></button>)}</div>
      {!draft && <div className="training-empty"><p>先选一段 10–30 秒、全身入镜的正手短片。相同机位、来球设置和成功标准，能帮助下一次比较。</p><button className="training-button" onClick={() => choose(null)}>开始正手试练</button></div>}
    </section>
    {draft && <>
      <section className="training-panel"><h2>练习条件</h2><div className="training-grid">
        <label className="training-label">标题<input value={draft.title} maxLength={200} onChange={event => patch({ title: event.target.value })}/></label><label className="training-label">日期<input type="date" value={draft.date.slice(0, 10)} onChange={event => patch({ date: event.target.value })}/></label>
        <label className="training-label">项目<select value={draft.stroke} onChange={event => patch({ stroke: event.target.value as Review['stroke'] })}>{Object.entries(strokeLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="training-label">来球方式<select value={draft.feed} onChange={event => patch({ feed: event.target.value as Review['feed'] })}><option value="machine">发球机</option><option value="coach">教练喂球</option><option value="partner">球友</option><option value="self">自己练习</option></select></label>
        <label className="training-label">机位<select value={draft.camera} onChange={event => patch({ camera: event.target.value as Review['camera'] })}><option value="side">侧面</option><option value="rear">后方</option><option value="front">前方</option><option value="other">其他</option></select></label>
        <label className="training-label">关联上次复盘<select value={draft.previousReviewId ?? ''} onChange={event => patch({ previousReviewId: event.target.value || null })}><option value="">首次记录</option>{state.reviews.filter(review => review.id !== draft.id).map(review => <option key={review.id} value={review.id}>{review.date} · {review.title}</option>)}</select></label>
        <label className="training-label training-full">可重复的条件<textarea value={draft.conditions} maxLength={4000} onChange={event => patch({ conditions: event.target.value })} placeholder="球机频率、落点与速度档位／球友；你的站位、目标区域、机位距离等。"/></label>
      </div></section>
      <section className="training-panel"><h2>原始录像</h2><label className="training-label">上传录像（最多 {Math.floor(capabilities.maxMediaBytes / 1024 / 1024)} MB）<input type="file" disabled={busy} accept="video/mp4,video/quicktime,video/webm" onChange={event => upload(event.target.files?.[0])}/></label>
        <p className="training-muted">{busy ? '正在保存录像…' : asset ? `${asset.name} · ${asset.status === 'ready' ? '可播放' : '上传待完成'}` : draft.mediaId ? '录像文件缺失，请重新上传关联。复盘文字仍保留。' : '建议先裁剪短片。iPhone 高效率编码若无法播放，可导出 H.264 MP4。'}</p>
        {asset?.status === 'ready' && asset.contentType.startsWith('video/') && <video key={asset.id} className="training-video" ref={videoRef} src={asset.url} crossOrigin="anonymous" controls playsInline preload="metadata" onLoadedMetadata={event => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds) && seconds <= 86400 && draft.durationSeconds !== seconds) patch({ durationSeconds: seconds }); }} onError={() => setError('录像暂时无法播放。请检查编码或登录状态；可点击“重新加载录像”重试。')}/>}
        {asset?.status === 'ready' && <button type="button" className="training-secondary" onClick={() => { setError(''); videoRef.current?.load(); }}>重新加载录像</button>}
        {asset?.status === 'ready' && <VideoTools key={`${draft.id}:${asset.id}`} videoRef={videoRef} stroke={strokeLabel[draft.stroke]} coachNotes={draft.coachRevisions.map(item => item.note).join('\n')} aiConfigured={capabilities.aiConfigured} poseModelUrl={capabilities.poseModelUrl} onAnalysis={setPending}/>}
      </section>
      {error && <p className="training-feedback" data-kind="error" role="alert">{error}</p>}
      {pending && <section className="training-panel training-soft"><h2>待确认的影像建议</h2>{pending.insufficientEvidence && <p>证据不足，请补拍或请教练复核。</p>}{pending.observations.map(item => <article key={item.id}><p><strong>{item.kind === 'visible' ? '画面观察' : '待确认假设'}</strong> · {timestamp(item.atSeconds)} · 置信度 {item.confidence}<br/>{item.text}</p><button className="training-text-button" onClick={() => { if (!draft.observations.some(saved => saved.id === item.id)) patch({ observations: [...draft.observations, item] }); }}>采纳这条观察</button></article>)}<p><strong>候选提示：</strong>{pending.cue}<br/>{pending.drill}<br/>{pending.successMetric}</p><ul>{pending.limitations.map((item,index) => <li key={index}>{item}</li>)}</ul><div className="training-actions"><button className="training-secondary" onClick={() => patch({ cue: pending.cue, drill: pending.drill, successMetric: pending.successMetric })}>填入候选任务</button><button className="training-text-button" onClick={() => setPending(null)}>关闭建议</button></div></section>}
      <section className="training-panel"><h2>画面观察与假设</h2><div className="training-grid"><label className="training-label">时间点（秒）<input type="number" min="0" step="0.01" value={time} onChange={event => setTime(event.target.value)}/></label><div className="training-actions" style={{marginTop:0,alignSelf:'end'}}><button className="training-secondary" onClick={() => setTime((videoRef.current?.currentTime ?? 0).toFixed(2))}>记录当前时间</button></div><label className="training-label">记录类型<select value={kind} onChange={event => setKind(event.target.value as Observation['kind'])}><option value="visible">画面可见的观察</option><option value="hypothesis">需要验证的解释</option></select></label><label className="training-label training-full">内容<textarea value={observation} maxLength={4000} onChange={event => setObservation(event.target.value)} placeholder="例如画面中拍头的位置；解释原因时选择需要验证。"/></label></div><button className="training-secondary" disabled={!observation.trim()} onClick={addObservation}>加入观察</button>
        <ul className="training-observations">{draft.observations.map(item => <li key={item.id}><button className="training-text-button" onClick={() => seek(item.atSeconds)}>{timestamp(item.atSeconds)}</button><span>{item.kind === 'visible' ? '观察' : '假设'} · {item.source} · {item.text}</span><button className="training-text-button" onClick={() => patch({ observations: draft.observations.filter(value => value.id !== item.id) })} aria-label={`删除 ${timestamp(item.atSeconds)} 观察`}>删除</button></li>)}</ul>
      </section>
      <section className="training-panel"><h2>教练校准</h2><p className="training-muted">保留历次反馈，再据此修改下方任务。</p>{draft.coachRevisions.map(item => <p key={item.id}><strong>{item.date}</strong> · {item.note}</p>)}<label className="training-label">本次教练意见<textarea maxLength={4000} value={coachNote} onChange={event => setCoachNote(event.target.value)}/></label><button className="training-secondary" disabled={!coachNote.trim()} onClick={() => { patch({ coachRevisions: [...draft.coachRevisions, { id: crypto.randomUUID(), date: today, note: coachNote.trim() }] }); setCoachNote(''); }}>加入校准记录</button></section>
      <section className="training-panel training-soft"><h2>下一次，只练一个提示</h2><div className="training-grid"><label className="training-label training-full">唯一动作提示<input value={draft.cue} maxLength={4000} onChange={event => patch({ cue: event.target.value })} placeholder="写成你在击球前能记住的短句"/></label><label className="training-label training-full">下次怎样练<textarea value={draft.drill} maxLength={4000} onChange={event => patch({ drill: event.target.value })}/></label><label className="training-label training-full">成功标准与复测方式<textarea value={draft.successMetric} maxLength={4000} onChange={event => patch({ successMetric: event.target.value })} placeholder="例如：同档位20次喂球、指定区域内次数；不要混合球友对拉和球机指标。"/></label></div><div className="training-actions"><button className="training-button" disabled={busy} onClick={() => save(true)}>保存并设为当前任务</button><button className="training-secondary" disabled={busy} onClick={() => save()}>只保存复盘</button>{dirty && <span className="training-muted">复盘有未保存输入</span>}</div></section>
      {previous && <section className="training-panel"><h2>同条件复测对照</h2><p className="training-muted">{differences.length ? `本次与上次不同：${differences.join('、')}。结果需要结合这些差异解释。` : '已记录的机位、来球与复测标准相同；仍请检查实际现场条件。'}</p><div className="training-comparison"><article><h3>上次 · {previous.date}</h3><p>{previous.cue}</p><p>{previous.successMetric}</p><p className="training-muted">{previous.conditions}</p></article><article><h3>本次 · {draft.date}</h3><p>{draft.cue}</p><p>{draft.successMetric}</p><p className="training-muted">{draft.conditions}</p></article></div></section>}
    </>}
  </>;
}
