'use client';
import { useState } from 'react';
import type { PracticeSession, GymWorkout, SourceCard, TrainingProfile } from '@/lib/training-types';

export function GymSuggestion({ profile, sourceCards, sessions, workouts, today, onExercise }: { profile: TrainingProfile; sourceCards: SourceCard[]; sessions: PracticeSession[]; workouts: GymWorkout[]; today: string; onExercise: (name: string) => void }) {
  const [readiness, setReadiness] = useState('');
  const start = new Date(`${today}T00:00:00+08:00`).getTime() - 6 * 86400000;
  const end = new Date(`${today}T00:00:00+08:00`).getTime() + 86400000;
  const inWeek = (date: string) => { const time = new Date(date.length === 10 ? `${date}T00:00:00+08:00` : date).getTime(); return time >= start && time < end; };
  const recent = sessions.filter(session => inWeek(session.date));
  const recentWorkouts = workouts.filter(workout => inWeek(workout.date));
  const courtToday = recent.some(session => session.kind !== 'gym' && session.date.slice(0, 10) === today);
  if (!profile.gymExperience.trim() || !profile.equipment.length) return <section className="training-panel training-soft"><h2>非练球日的健身建议</h2><p>先在“每周安排”填入健身经验和可用器械，再组合训练。已有教练安排时，可以直接记录实际完成组次。</p></section>;
  const equipment = profile.equipment.join(' ');
  const hasBand = /弹力|阻力带|band/i.test(equipment);
  const hasWeight = /哑铃|杠铃|壶铃|dumbbell|barbell/i.test(equipment);
  const hasMachine = /固定器械|划船机|综合器械|健身房|拉力器|龙门架/i.test(equipment);
  const exercises = [
    { name: '自重弓步蹲', volume: '先用舒适幅度，每侧 8 次 × 2 组', chapter: '55-lunge', why: '下肢基础力量；需要先掌握动作。' },
    { name: hasBand ? '弹力带划船' : hasMachine ? '坐姿器械划船' : hasWeight ? '轻哑铃划船' : '上肢拉：待选择熟悉动作', volume: '熟悉的轻负重，8–12 次 × 2 组', chapter: '', why: hasBand || hasMachine || hasWeight ? '按你填写的器械选择上肢拉动作。' : '需要补充可用器械或与教练选择动作。' },
    { name: '墙面或高位俯卧撑', volume: '选择能平稳完成的高度，8–12 次 × 2 组', chapter: '29-push-up', why: '上肢推的基础选项；高度可调整。' },
    { name: '核心控制：待选择熟悉动作', volume: '从原书核心章节和教练已有安排中选 1 项', chapter: '42-core-overview', why: '根据你会做的动作选择，不从击球录像推断肌肉弱点。' },
  ];
  return <section className="training-panel training-soft"><h2>非练球日的起步模板</h2><p className="training-muted">近 7 天练习日志：{recent.filter(session => session.kind !== 'gym').length} 次球场练习，{recent.reduce((sum,session) => sum + session.minutes, 0)} 分钟已记录训练。另有 {recentWorkouts.length} 份健身组次记录（不重复累加时间）。{recent.some(session => (session.exertion ?? 0) >= 8) && '近期记录过较高用力程度，先结合实际恢复感受选择。'}</p><label className="training-label">今日恢复感受<select value={readiness} onChange={event => setReadiness(event.target.value)}><option value="">先选择今天的状态</option><option value="ready">精神和体力正常，准备轻量起步</option><option value="tired">有疲劳，今天选择恢复或减少训练</option></select></label>{courtToday && <p className="training-muted">今天已有球场记录，下面的力量模板建议安排到下一非练球日。</p>}{readiness !== 'ready' || courtToday ? <p style={{marginTop:15}}>先选择恢复状态。感觉疲劳或当天已练球时，可以休息或做熟悉的轻松活动，下一非练球日再使用模板；系统不会自动加量。</p> : <><p style={{marginTop:15}}>先热身，再从下肢、上肢拉、上肢推和核心各选一个熟悉的动作，预留约 30–45 分钟。下面是可调整的草案；重量由你已有训练经验和教练反馈确定。</p>{profile.constraints && <p className="training-muted">按你的限制调整：{profile.constraints}。有冲突的动作先跳过。</p>}<div className="training-exercises">{exercises.map(exercise => {
    const source = sourceCards.find(card => card.chapter === exercise.chapter);
    return <article className="training-exercise" key={exercise.name}><h3>{exercise.name}</h3><p>{exercise.volume}</p><p className="training-muted">{exercise.why}</p>{source && <a className="training-source" href={source.href} target="_blank" rel="noreferrer">相关原书章节：{source.title}</a>}<button type="button" className="training-text-button" disabled={exercise.name.includes('待选择')} onClick={() => onExercise(exercise.name)}>记录实际完成</button></article>;
  })}</div><p className="training-muted">组次是起步示例，未替你完成训练。一般力量训练参考：<a href="https://www.acsm.org/docs/default-source/files-for-resource-library/resistance-training-for-health.pdf" target="_blank" rel="noreferrer">ACSM Resistance Training for Health</a>；动作选择由本项目根据器械组合。用力程度和次日疲劳记录后再调整。</p></>}</section>;
}
