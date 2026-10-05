'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, CalendarDays, Clapperboard, Dumbbell, LockKeyhole, Save, Download, Sprout } from 'lucide-react';
import type { MediaAsset, MediaReservation, RestoreResult, TrainingBootstrap, TrainingExport, TrainingState } from '@/lib/training-types';
import { publicPath } from '@/lib/urls';
import { MAX_TRAINING_EXPORT_BYTES } from '@/lib/training-limits';
import { TodayPanel } from './TodayPanel';
import { ReviewPanel } from './ReviewPanel';
import { WeekPanel } from './WeekPanel';
import { LessonPanel } from './LessonPanel';
import { downloadJson, trainingRequest, TrainingRequestError } from './client';
import type { LocalDraft } from './client';
import './lesson.css';

type View = 'today' | 'review' | 'week' | 'lessons';

export function TrainingApp({ initial, today, username }: { initial: TrainingBootstrap; today: string; username: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>('today');
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState(initial.state);
  const [media, setMedia] = useState(initial.media);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [backup, setBackup] = useState<(TrainingExport & { uiDrafts?: Record<string, LocalDraft> }) | null>(null);
  const [uiDrafts, setUiDrafts] = useState<Record<string, LocalDraft>>({});
  const [draftEpoch, setDraftEpoch] = useState(0);
  const todayDraftChanged = useCallback((draft: LocalDraft) => setUiDrafts(current => ({ ...current, today: draft })), []);
  const reviewDraftChanged = useCallback((draft: LocalDraft) => setUiDrafts(current => ({ ...current, review: draft })), []);
  const lessonDraftChanged = useCallback((draft: LocalDraft) => setUiDrafts(current => ({ ...current, lessons: draft })), []);
  const restoreInput = useRef<HTMLInputElement>(null);
  const recordDirty = JSON.stringify(state) !== JSON.stringify(saved.state);
  const dirty = recordDirty || Object.values(uiDrafts).some(draft => draft.dirty);
  function protectNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm('还有未保存的训练输入。请先另存草稿；继续离开？')) event.preventDefault();
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(next = state) {
    setState(next); setBusy(true); setFeedback(null);
    try {
      const result = await trainingRequest<TrainingBootstrap>('/api/training/', { method: 'PUT', body: JSON.stringify({ state: next, revision: saved.revision }) });
      setSaved(result); setState(result.state); setMedia(result.media); setConflict(false);
      setFeedback({ kind: 'success', message: '训练资料已保存。' }); return true;
    } catch (error) {
      const conflicting = error instanceof TrainingRequestError && error.status === 409;
      setConflict(conflicting);
      setFeedback({ kind: 'error', message: conflicting ? '资料已在另一个页面更新。你的未保存输入仍保留；先另存草稿，再读取最新资料继续编辑。' : (error as Error).message });
      return false;
    } finally { setBusy(false); }
  }

  function exportDraft() {
    const value = { format: 'tennis-training-records', version: 1, exportedAt: new Date().toISOString(), state, media, mediaIncluded: false, uiDrafts };
    if (new TextEncoder().encode(JSON.stringify(value, null, 2)).length > MAX_TRAINING_EXPORT_BYTES) { setFeedback({ kind: 'error', message: '资料与表单草稿合计超过 4 MB，请分别保留草稿并导出已保存记录。' }); return; }
    downloadJson(value, `tennis-training-draft-${today}.json`);
  }

  async function reloadSaved() {
    if (dirty && !window.confirm('读取最新资料会替换本页未保存的输入。请先另存草稿。继续读取？')) return;
    setBusy(true);
    try {
      const result = await trainingRequest<TrainingBootstrap>('/api/training/');
      setSaved(result); setState(result.state); setMedia(result.media); setConflict(false); setUiDrafts({}); setDraftEpoch(current => current + 1);
      setFeedback({ kind: 'success', message: '已读取最新保存的资料。' });
    } catch (error) { setFeedback({ kind: 'error', message: (error as Error).message }); }
    finally { setBusy(false); }
  }

  async function uploadMedia(file: File) {
    if (file.size > saved.capabilities.maxMediaBytes) throw new Error(`文件超过 ${(saved.capabilities.maxMediaBytes / 1024 / 1024).toFixed(0)} MB。请先裁剪成短片。`);
    let asset: MediaAsset;
    if (saved.capabilities.storageDriver === 'vercel-blob') {
      const reservation = await trainingRequest<MediaReservation>('/api/training/media/', { method: 'POST', body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size }) });
      const { upload } = await import('@vercel/blob/client');
      await upload(reservation.pathname, file, { access: 'private', handleUploadUrl: publicPath(reservation.uploadUrl) });
      asset = await trainingRequest<MediaAsset>(`/api/training/media/${reservation.asset.id}/`, { method: 'POST', body: JSON.stringify({}) });
    } else {
      const body = new FormData(); body.append('file', file);
      asset = await trainingRequest<MediaAsset>('/api/training/media/', { method: 'POST', body });
    }
    setMedia(previous => [...previous.filter(item => item.id !== asset.id), asset]);
    return asset;
  }

  async function exportSaved() {
    setBusy(true);
    try { downloadJson(await trainingRequest<TrainingExport>('/api/training/export/'), `tennis-training-${today}.json`); }
    catch (error) { setFeedback({ kind: 'error', message: (error as Error).message }); }
    finally { setBusy(false); }
  }

  async function previewBackup(file: File | undefined) {
    setBackup(null);
    if (!file) return;
    try {
      if (file.size > MAX_TRAINING_EXPORT_BYTES) throw new Error('备份文件超过 4 MB。');
      const value = JSON.parse(await file.text()) as TrainingExport;
      if (value.format !== 'tennis-training-records' || value.version !== 1 || !value.state || !Array.isArray(value.state.reviews) || !Array.isArray(value.state.sessions) || !Array.isArray(value.state.workouts)) throw new Error('请选择本系统导出的训练备份 JSON。');
      setBackup(value); setFeedback(null);
    } catch (error) { setFeedback({ kind: 'error', message: (error as Error).message }); }
  }

  async function restore() {
    if (!backup) return;
    if (dirty && !window.confirm('恢复会替换当前资料并清除本页未提交表单，请先另存草稿。继续恢复？')) return;
    setBusy(true); setFeedback(null);
    try {
      const result = await trainingRequest<RestoreResult>('/api/training/restore/', { method: 'POST', body: JSON.stringify({ backup, revision: saved.revision }) });
      setSaved(result); setState(result.state); setMedia(result.media); setBackup(null); setConflict(false); setUiDrafts({}); setDraftEpoch(current => current + 1);
      if (restoreInput.current) restoreInput.current.value = '';
      setFeedback({ kind: 'success', message: `备份已恢复。${result.warnings.join(' ')}` });
    } catch (error) { setFeedback({ kind: 'error', message: (error as Error).message }); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (dirty && !window.confirm('还有未保存的训练输入，退出会丢失本页草稿。继续退出？')) return;
    setBusy(true);
    try { await trainingRequest('/api/auth/logout/', { method: 'POST' }); router.replace('/training/login/'); router.refresh(); }
    catch (error) { setFeedback({ kind: 'error', message: (error as Error).message }); setBusy(false); }
  }

  return <>
    <a className="skip-link" href="#training-main">跳到训练内容</a>
    <header className="site-header training-header"><Link href="/" onClick={protectNavigation} className="wordmark">书间</Link><span className="header-divider"/><span className="header-label">私人训练</span><div className="training-header-links"><Link href="/" onClick={protectNavigation}>资料书架</Link><span>{username}</span><button disabled={busy} onClick={logout}>退出</button></div></header>
    <main id="training-main" className="training-shell">
      <div className="training-heading"><div><span className="training-eyebrow">一个提示 · 一次练习 · 同条件复测</span><h1>我的网球训练</h1><p>把教练的反馈、球场练习和健身记录连接起来。</p></div><span className="training-private"><LockKeyhole size={15}/><span>私人资料</span></span></div>
      <nav className="training-nav" aria-label="私人训练视图">{([{ id: 'today', label: '今日训练', icon: Dumbbell }, { id: 'review', label: '录像复盘', icon: Clapperboard }, { id: 'week', label: '每周安排', icon: CalendarDays }, { id: 'lessons', label: '教学资料', icon: BookOpen }] as const).map(item => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}><item.icon size={17}/>{item.label}</button>)}</nav>
      {feedback && <div className="training-feedback" data-kind={feedback.kind} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</div>}
      {conflict && <div className="training-actions" style={{marginTop:0,marginBottom:22}}><button className="training-secondary" onClick={exportDraft}><Download size={15}/>另存当前草稿</button><button className="training-secondary" onClick={reloadSaved} disabled={busy}>读取最新资料</button></div>}
      <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
        <div className="training-pilot"><Sprout size={19}/><p><strong>先完成一轮正手试练：</strong>保存短片 → 写下一个提示 → 请教练校准 → 按相同来球条件练习 → 重拍并记录结果。试练期间，也可以安排反手和其他训练。</p></div>
        <section hidden={view !== 'today'} aria-label="今日训练"><TodayPanel key={draftEpoch} state={state} today={today} sourceCards={saved.sourceCards} media={media} active={view === 'today'} onChange={setState} onSave={save} onReview={() => setView('review')} onLessons={() => setView('lessons')} onDraftChange={todayDraftChanged}/></section>
        <section hidden={view !== 'review'} aria-label="录像复盘"><ReviewPanel key={draftEpoch} state={state} media={media} today={today} capabilities={saved.capabilities} onChange={setState} onSave={save} uploadMedia={uploadMedia} active={view === 'review'} onDraftChange={reviewDraftChanged}/></section>
        <section hidden={view !== 'week'} aria-label="每周安排"><WeekPanel state={state} today={today} onChange={setState} onSave={save}/></section>
        <section hidden={view !== 'lessons'} aria-label="教学资料"><LessonPanel key={draftEpoch} state={state} media={media} capabilities={saved.capabilities} onSave={save} uploadMedia={uploadMedia} active={view === 'lessons'} onDraftChange={lessonDraftChanged}/></section>
        <div className="training-actions"><button className="training-button" onClick={() => save()} disabled={!recordDirty || busy}><Save size={16}/>保存资料更改</button>{dirty && <button className="training-secondary" onClick={exportDraft}><Download size={15}/>另存当前草稿</button>}<span className="training-muted" aria-live="polite">{busy ? '正在保存…' : dirty ? '有未保存的输入；复盘／训练／教学表单请用各自保存按钮' : '已与保存资料同步'}</span></div>
        <details className="training-panel training-details" style={{marginTop:28}}><summary>备份与恢复<small>训练记录 JSON</small></summary><p className="training-muted">备份包含训练资料、教学卡及素材索引。原片和 GIF 文件需要另外保留。恢复会替换当前训练资料；书籍内容保持原样。</p><div className="training-actions"><button className="training-secondary" onClick={exportSaved}><Download size={15}/>导出已保存资料</button>{dirty && <button className="training-text-button" onClick={exportDraft}>另存当前草稿</button>}</div><label className="training-label" style={{marginTop:20}}>选择训练备份<input ref={restoreInput} type="file" accept="application/json,.json" onChange={event => previewBackup(event.target.files?.[0])}/></label>{backup && <div className="training-soft training-panel" style={{marginTop:18,marginBottom:0}}><h3>恢复预览</h3><p>{backup.state.reviews.length} 条录像复盘 · {backup.state.sessions.length} 条练习记录 · {backup.state.workouts.length} 次健身记录 · {backup.state.lessons?.length ?? 0} 条教学资料</p><p className="training-muted">确认后，用这份备份替换当前训练资料。已有素材按本机可用索引重新关联。</p>{backup.uiDrafts && <details><summary>查看备份中的未提交表单草稿</summary><p className="training-muted">这些输入尚未提交为训练记录。恢复资料不会自动提交它们；请展开查看并补回对应表单。</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflow:'auto',fontSize:12}}>{JSON.stringify(backup.uiDrafts, null, 2)}</pre></details>}<button className="training-button" onClick={restore}>确认恢复这份备份</button></div>}</details>
      </fieldset>
      <footer className="training-footer"><span>资料来源可回到书中核查；训练建议通过实际练习和教练反馈调整。</span><span>{today} · 私人训练</span></footer>
    </main>
  </>;
}
