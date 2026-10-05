'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TrainingExport } from '@/lib/training-types';
import { trainingRequest } from './client';
import { MAX_TRAINING_EXPORT_BYTES } from '@/lib/training-limits';

export function RecoveryPanel({ revision }: { revision: string | null }) {
  const router = useRouter();
  const [backup, setBackup] = useState<TrainingExport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function inspect(file: File | undefined) {
    setBackup(null); setError('');
    if (!file) return;
    try {
      if (file.size > MAX_TRAINING_EXPORT_BYTES) throw new Error('备份文件不能超过 4 MB。');
      const value = JSON.parse(await file.text()) as TrainingExport;
      if (value.format !== 'tennis-training-records' || value.version !== 1 || !value.state || !Array.isArray(value.state.reviews) || !Array.isArray(value.state.sessions) || !Array.isArray(value.state.workouts)) throw new Error('请选择本系统导出的训练记录 JSON。');
      setBackup(value);
    } catch (error) { setError((error as Error).message); }
  }
  async function restore() {
    if (!backup) return;
    setBusy(true); setError('');
    try {
      await trainingRequest('/api/training/restore/', { method: 'POST', body: JSON.stringify({ backup, revision }) });
      router.refresh();
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <><header className="site-header"><Link href="/" className="wordmark">书间</Link><span className="header-divider"/><span className="header-label">私人训练恢复</span></header><main className="training-shell"><section className="training-panel"><h1>训练记录需要恢复</h1><p>当前记录文件无法解析。系统没有写入空资料，原文件会在成功恢复前另存到历史备份；四册书与录像文件保留。</p><label className="training-label">选择已导出的训练备份<input type="file" accept=".json,application/json" disabled={busy} onChange={event => inspect(event.target.files?.[0])}/></label>{backup && <div className="training-panel training-soft" style={{marginTop:20}}><h2>恢复预览</h2><p>{backup.state.reviews.length} 条复盘 · {backup.state.sessions.length} 条练习 · {backup.state.workouts.length} 次健身</p><p className="training-muted">记录备份不含视频。恢复后缺失素材会保留引用，可重新关联。</p><button className="training-button" disabled={busy} onClick={restore}>{busy ? '正在恢复…' : '确认用这份备份恢复'}</button></div>}{error && <p className="training-feedback" data-kind="error" role="alert">{error}</p>}<Link href="/" className="training-text-button">回到书架</Link></section></main></>;
}
