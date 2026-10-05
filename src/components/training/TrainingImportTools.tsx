'use client';
import { useState } from 'react';
import type { GymWorkout } from '@/lib/training-types';
import type { ImportFormat, ImportPreview } from '@/lib/training-import';

export function TrainingImportTools({ workouts, onChange }: { workouts: GymWorkout[]; onChange: (workouts: GymWorkout[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ImportFormat>('auto');
  const [weightUnit, setWeightUnit] = useState<'' | 'kg' | 'lb'>('');
  const [distanceUnit, setDistanceUnit] = useState<'' | 'km' | 'mile'>('');
  const [timeZone, setTimeZone] = useState('Asia/Shanghai');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  function invalidate() { setPreview(null); setError(''); setNotice(''); }
  async function inspect() {
    if (!file) return;
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('导入文件不能超过 2 MB。');
      const { parseTrainingImport } = await import('@/lib/training-import');
      setPreview(parseTrainingImport(await file.text(), format, { weightUnit: weightUnit || undefined, distanceUnit: distanceUnit || undefined, timeZone }));
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview) return;
    const { mergeImportedWorkouts } = await import('@/lib/training-import');
    const merged = mergeImportedWorkouts(workouts, preview.workouts);
    onChange(merged.workouts); setPreview(null);
    setNotice(`已加入 ${merged.added} 次训练，跳过 ${merged.duplicates} 次重复记录。请点击训练区的保存按钮持久保存。`);
  }
  return <details className="training-details">
    <summary>从健身 App 导入记录 <small>Hevy / Strong CSV · 通用 JSON</small></summary>
    <p className="training-muted">文件在浏览器内解析，确认前不会加入记录。训记需要先转换成通用 JSON；这里不提供账户同步。</p>
    <div className="training-grid">
      <label className="training-label training-full">选择导出文件<input type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); invalidate(); }}/></label>
      <label className="training-label">格式<select value={format} disabled={busy} onChange={event => { setFormat(event.target.value as ImportFormat); invalidate(); }}><option value="auto">自动识别具名表头</option><option value="hevy">Hevy CSV</option><option value="strong">Strong CSV</option><option value="generic-json">通用 JSON v1</option></select></label>
      <label className="training-label">CSV 日期时区<select value={timeZone} disabled={busy} onChange={event => { setTimeZone(event.target.value); invalidate(); }}><option value="Asia/Shanghai">中国时间 · Asia/Shanghai</option><option value="UTC">UTC</option></select></label>
      <label className="training-label">缺少表头单位时，重量单位<select value={weightUnit} disabled={busy} onChange={event => { setWeightUnit(event.target.value as typeof weightUnit); invalidate(); }}><option value="">尚未指定</option><option value="kg">公斤 kg</option><option value="lb">磅 lb</option></select></label>
      <label className="training-label">缺少表头单位时，距离单位<select value={distanceUnit} disabled={busy} onChange={event => { setDistanceUnit(event.target.value as typeof distanceUnit); invalidate(); }}><option value="">尚未指定</option><option value="km">公里 km</option><option value="mile">英里 mile</option></select></label>
    </div>
    <div className="training-actions"><button type="button" className="training-secondary" disabled={!file || busy} onClick={inspect}>{busy ? '正在解析…' : '预览导入'}</button></div>
    {error && <p className="training-feedback" data-kind="error" role="alert">{error}</p>}
    {notice && <p className="training-feedback" data-kind="success" role="status">{notice}</p>}
    {preview && <div className="training-panel training-soft" aria-label="导入预览">
      <h3>{preview.source} · {preview.workouts.length} 次训练 / {preview.rowCount} 组</h3>
      {preview.warnings.map(warning => <p className="training-muted" key={warning}>{warning}</p>)}
      {preview.workouts.slice(0, 5).map(workout => <div key={workout.id}><strong>{workout.title}</strong> · {new Intl.DateTimeFormat('zh-CN', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(workout.date))}<p className="training-muted">{workout.sets.slice(0, 3).map(set => `${set.exercise}：${set.weightKg === null ? '无重量' : `${set.weightKg} kg`} × ${set.reps ?? '—'}`).join('；')}（共 {workout.sets.length} 组）</p></div>)}
      {preview.workouts.length > 5 && <p className="training-muted">预览前 5 次训练；确认后加入全部记录。</p>}
      <div className="training-actions"><button className="training-button" type="button" onClick={confirm}>确认加入记录</button><button className="training-secondary" type="button" onClick={() => setPreview(null)}>取消预览</button></div>
    </div>}
  </details>;
}
