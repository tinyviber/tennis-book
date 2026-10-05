'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Clapperboard, Dumbbell, Plus } from 'lucide-react';
import type { GymSet, GymWorkout, MediaAsset, PracticeSession, SourceCard, TrainingKind, TrainingState } from '@/lib/training-types';
import { TrainingImportTools } from './TrainingImportTools';
import { GymSuggestion } from './GymSuggestion';
import { TodayLesson } from './TodayLesson';
import { kindLabel, numberOrNull, trainingDateLabel } from './client';
import type { LocalDraft } from './client';

type Props = { state: TrainingState; today: string; sourceCards: SourceCard[]; media: MediaAsset[]; active: boolean; onChange: (state: TrainingState) => void; onSave: (state?: TrainingState) => Promise<boolean>; onReview: () => void; onLessons: () => void; onDraftChange: (draft: LocalDraft) => void };

export function TodayPanel({ state, today, sourceCards, media, active, onChange, onSave, onReview, onLessons, onDraftChange }: Props) {
  const [kind, setKind] = useState<TrainingKind>('machine');
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState('60');
  const [cost, setCost] = useState('');
  const [exertion, setExertion] = useState('');
  const [successes, setSuccesses] = useState('');
  const [attempts, setAttempts] = useState('');
  const [metric, setMetric] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [exercise, setExercise] = useState('');
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [setRpe, setSetRpe] = useState('');
  const [gymNotes, setGymNotes] = useState('');
  const [sets, setSets] = useState<GymSet[]>([]);
  const [gymSource, setGymSource] = useState<SourceCard | null>(null);
  const task = state.currentTask?.status === 'active' ? state.currentTask : null;
  const source = sourceCards.find(card => card.id === task?.sourceCardId);
  const cards = sourceCards.filter(card => card.category === (kind === 'gym' ? 'gym' : 'court'));
  const pinnedLesson = state.lessons.find(lesson => lesson.id === state.pinnedLessonId);
  useEffect(() => {
    const value = { kind, date, minutes, cost, exertion, successes, attempts, metric, notes, exercise, reps, weight, setRpe, gymNotes, sets, gymSource };
    const dirty = !!(cost || exertion || successes || attempts || metric || notes || exercise || reps || weight || setRpe || gymNotes || sets.length || date !== today || minutes !== '60');
    onDraftChange({ dirty, value });
  }, [kind, date, minutes, cost, exertion, successes, attempts, metric, notes, exercise, reps, weight, setRpe, gymNotes, sets, gymSource, today, onDraftChange]);

  async function recordSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const hits = kind === 'gym' ? null : numberOrNull(successes), count = kind === 'gym' ? null : numberOrNull(attempts);
    if ((hits === null) !== (count === null)) { setError('请同时填写成功数和总尝试数，或把两项一起留空。'); return; }
    if (hits !== null && count !== null && (count <= 0 || hits > count)) { setError('总尝试数须大于 0，成功数不能超过总尝试数。'); return; }
    if (count !== null && !metric.trim()) { setError('请说明这次成功的标准，例如“正手落入指定区域”。'); return; }
    const session: PracticeSession = { id: crypto.randomUUID(), date, kind, minutes: Number(minutes), costCny: numberOrNull(cost), exertion: numberOrNull(exertion), taskId: kind === 'gym' ? null : task?.id ?? null, successes: hits, attempts: count, metric: kind === 'gym' ? '' : metric.trim(), notes: notes.trim() };
    const next = { ...state, sessions: [...state.sessions, session] };
    if (await onSave(next)) { setSuccesses(''); setAttempts(''); setNotes(''); setCost(''); setExertion(''); setMetric(''); setMinutes('60'); setDate(today); }
  }

  function addSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!exercise.trim()) return;
    if (reps === '' && weight === '') { setError('请填写这组的次数或重量。'); return; }
    setSets(previous => [...previous, { id: crypto.randomUUID(), exercise: exercise.trim(), index: previous.filter(set => set.exercise === exercise.trim()).length + 1, reps: numberOrNull(reps), weightKg: numberOrNull(weight), durationSeconds: null, rpe: numberOrNull(setRpe) }]);
  }

  async function saveWorkout() {
    if (!sets.length) return;
    const workout: GymWorkout = { id: crypto.randomUUID(), date, title: '健身训练', source: 'manual', sourceId: null, notes: [gymNotes.trim(), gymSource ? `资料：${gymSource.title} · ${gymSource.href}` : ''].filter(Boolean).join('\n'), sets };
    if (await onSave({ ...state, workouts: [...state.workouts, workout] })) { setSets([]); setGymNotes(''); setGymSource(null); setExercise(''); setReps(''); setWeight(''); setSetRpe(''); }
  }

  return <>
    <section className="training-panel training-soft"><div className="training-section-head"><div><h2>今天，练好一件事</h2><p>{today} · 按实际完成情况记录</p></div>{task && <span className="training-badge" data-active="true">当前任务</span>}</div>
      {task ? <><div className="training-cue"><small>本轮唯一提示</small><p>{task.cue}</p><span>{task.drill}</span></div><p><strong>怎样复测：</strong>{task.successMetric || '在复盘中补充可重复的成功标准。'}</p>{source && <a className="training-source" href={source.href} target="_blank" rel="noreferrer">{source.title} · 查看出处<ArrowUpRight size={13}/></a>}<div className="training-actions"><button className="training-secondary" onClick={onReview}><Clapperboard size={15}/>查看复盘与教练意见</button><button className="training-text-button" onClick={() => onSave({ ...state, currentTask: { ...task, status: 'done' } })}><Check size={15}/>结束这轮任务</button></div></> : <div className="training-empty"><Clapperboard size={24}/><p>保存一段录像，把下次只练的一个提示放到这里。你也可以先记录已有的练习和健身。</p><button className="training-button" onClick={onReview}>开始录像复盘</button></div>}
    </section>
    {pinnedLesson && <TodayLesson lesson={pinnedLesson} media={media} active={active} onOpen={onLessons}/>}
    <div className="training-choice-row" aria-label="今天的训练类型" style={{marginBottom:22}}>{(['coach', 'machine', 'partner', 'gym'] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'gym' && <Dumbbell size={15}/>} {kindLabel[value]}</button>)}</div>
    {kind === 'gym' && <GymSuggestion profile={state.profile} sourceCards={sourceCards} sessions={state.sessions} workouts={state.workouts} today={today} onExercise={name => { setExercise(name); setGymSource(null); document.getElementById('gym-exercise')?.focus(); }}/>}
    <section className="training-panel"><div className="training-section-head"><div><h2>{kind === 'gym' ? '健身资料卡' : '球场资料卡'}</h2><p>{kind === 'gym' ? '按你熟悉的动作选练，组次和重量记录实际完成值。' : '结合当前提示选择练法，再回到原书核对。'}</p></div></div>
      {kind === 'gym' && <p className="training-muted">{state.profile.gymExperience ? `健身经验：${state.profile.gymExperience}` : '先在每周安排填写健身经验和可用器械，再选择熟悉的动作。'} {state.profile.equipment.length > 0 && `器械：${state.profile.equipment.join('、')}`}</p>}
      {state.profile.constraints && <p className="training-muted">你的训练限制：{state.profile.constraints}</p>}
      <div className="training-exercises">{cards.map(card => <article className="training-exercise" key={card.id}><h3>{card.title}</h3><p>{card.summary}</p><a className="training-source" href={card.href} target="_blank" rel="noreferrer">原书{card.pageStart === null ? '章节' : `第 ${card.pageStart}${card.pageEnd !== card.pageStart && card.pageEnd !== null ? `–${card.pageEnd}` : ''} 页`}<ArrowUpRight size={13}/></a><p className="training-muted" style={{marginTop:7,marginBottom:0}}>{card.sourceNote}</p>{kind === 'gym' && <button className="training-text-button" onClick={() => { setExercise(card.title); setGymSource(card); document.getElementById('gym-exercise')?.focus(); }}>记录这个动作</button>}</article>)}</div>
      {!cards.length && <p className="training-muted">本机还没有可用的来源章节。仍可记录自己的训练。</p>}
    </section>
    {error && <p className="training-feedback" data-kind="error" role="alert">{error}</p>}
    {kind === 'gym' && <section className="training-panel"><h2>记录健身组次</h2><p className="training-muted">记录实际训练，不根据录像推断肌肉强弱。</p><form className="training-grid" onSubmit={addSet}><label className="training-label training-full">动作<input id="gym-exercise" value={exercise} onChange={event => setExercise(event.target.value)} placeholder="填写你完成的动作" maxLength={200} required/></label><label className="training-label">次数<input type="number" value={reps} onChange={event => setReps(event.target.value)} min="0" max="10000" step="1" inputMode="numeric"/></label><label className="training-label">重量（kg）<input type="number" value={weight} onChange={event => setWeight(event.target.value)} min="0" max="2000" step="0.1" inputMode="decimal"/></label><label className="training-label">这组用力程度（1–10，可留空）<input type="number" value={setRpe} onChange={event => setSetRpe(event.target.value)} min="1" max="10" step="0.5"/></label><div className="training-actions" style={{alignSelf:'end',marginTop:0}}><button className="training-secondary" type="submit"><Plus size={15}/>加入一组</button></div></form>
      {sets.length > 0 && <><div className="training-import-scroll"><table className="training-import-table"><thead><tr><th>动作</th><th>组</th><th>次数</th><th>kg</th><th>操作</th></tr></thead><tbody>{sets.map(set => <tr key={set.id}><td>{set.exercise}</td><td>{set.index}</td><td>{set.reps ?? '—'}</td><td>{set.weightKg ?? '—'}</td><td><button className="training-text-button" onClick={() => setSets(previous => previous.filter(item => item.id !== set.id))} aria-label={`移除${set.exercise}第${set.index}组`}>移除</button></td></tr>)}</tbody></table></div><label className="training-label" style={{marginTop:18}}>健身笔记<textarea value={gymNotes} onChange={event => setGymNotes(event.target.value)} maxLength={3000} placeholder="动作感受、调整与下次要点"/></label><div className="training-actions"><button className="training-button" onClick={saveWorkout}>保存这次健身</button><span className="training-muted">使用下方练习日期</span></div></>}
    </section>}
    <section className="training-panel"><div className="training-section-head"><div><h2>记录完成情况</h2><p>包含实际时间与费用，供下周安排参考。休息日无需提交。</p></div></div><form onSubmit={recordSession}><div className="training-grid"><label className="training-label">练习日期<input type="date" required value={date} onChange={event => setDate(event.target.value)}/></label><label className="training-label">实际训练分钟<input type="number" required min="1" max="1440" step="1" value={minutes} onChange={event => setMinutes(event.target.value)} inputMode="numeric"/></label><label className="training-label">实际费用（元，可留空）<input type="number" min="0" max="100000" step="0.01" value={cost} onChange={event => setCost(event.target.value)} inputMode="decimal"/></label><label className="training-label">用力程度（1–10，可留空）<input type="number" min="1" max="10" step="0.5" value={exertion} onChange={event => setExertion(event.target.value)}/></label>{kind !== 'gym' && <><label className="training-label training-full">本次成功标准<input value={metric} onChange={event => setMetric(event.target.value)} maxLength={500} placeholder={task?.successMetric || '例如：20 次固定喂球，正手落入指定区域'}/><small>球机练习与球友对拉分别记录，每次保持口径清楚。</small></label><label className="training-label">成功数（可留空）<input type="number" min="0" max="100000" step="1" value={successes} onChange={event => setSuccesses(event.target.value)} inputMode="numeric"/></label><label className="training-label">总尝试数（可留空）<input type="number" min="1" max="100000" step="1" value={attempts} onChange={event => setAttempts(event.target.value)} inputMode="numeric"/></label></>}<label className="training-label training-full">练习笔记<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={3000} placeholder="来球条件、提示是否有效、教练反馈、疲劳情况"/></label></div><div className="training-actions"><button className="training-button" type="submit">保存{kindLabel[kind]}练习记录</button></div></form></section>
    <section className="training-panel"><h2>最近练习</h2>{state.sessions.length ? <ul className="training-session-list">{[...state.sessions].sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8).map(session => <li key={session.id}><div><strong>{session.date} · {kindLabel[session.kind]}</strong><small>{session.minutes} 分钟{session.costCny !== null ? ` · ¥${session.costCny}` : ''}</small></div>{session.attempts !== null && session.successes !== null && <p>{session.metric}：{session.successes} / {session.attempts}（{Math.round(session.successes / session.attempts * 100)}%）</p>}{session.notes && <p>{session.notes}</p>}</li>)}</ul> : <p className="training-muted">还没有练习记录。完成后记录一次即可开始比较。</p>}
    </section>
    <TrainingImportTools workouts={state.workouts} onChange={workouts => onChange({ ...state, workouts })}/>
    {state.workouts.length > 0 && <section className="training-panel"><h2>最近健身</h2><ul className="training-session-list">{[...state.workouts].sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5).map(workout => <li key={workout.id}><div><strong>{trainingDateLabel(workout.date)} · {workout.title}</strong><small>{workout.sets.length} 组 · {workout.source === 'manual' ? '手动记录' : `导入：${workout.source}`}</small></div><p>{Array.from(new Set(workout.sets.map(set => set.exercise))).join('、')}</p>{workout.notes && <p style={{whiteSpace:'pre-line'}}>{workout.notes}</p>}</li>)}</ul></section>}
  </>;
}
