import { ContentError } from './content-store';
import type { GymWorkout, Observation, PlanCandidate, PracticeRate, TrainingState, WeekDay } from './training-types';
import { validateTeachingLesson } from './training-lessons';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function trainingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('训练资料必须是对象。');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 4000): string {
  if (typeof value !== 'string' || value.length > limit) throw new ContentError(`训练文字须为文本且不超过 ${limit} 字。`);
  return value.trim();
}
function number(value: unknown, min = 0, max = 1_000_000, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) throw new ContentError('训练数值不在有效范围内。');
  return value;
}
function optionalNumber(value: unknown, min = 0, max = 1_000_000, integer = false): number | null {
  return value === null ? null : number(value, min, max, integer);
}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new ContentError('训练选项无效。');
  return value as T;
}
export function validateMediaId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ContentError('训练素材标识无效。');
  return value.toLowerCase();
}
function id(value: unknown): string { return validateMediaId(value); }
function optionalId(value: unknown): string | null { return value === null ? null : id(value); }
function list<T>(value: unknown, parser: (item: unknown) => T, max = 1000): T[] {
  if (!Array.isArray(value) || value.length > max) throw new ContentError(`训练列表最多 ${max} 条。`);
  return value.map(parser);
}
function uniqueIds<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new ContentError('训练记录标识重复。');
  return items;
}
function days(value: unknown): WeekDay[] {
  const result = list(value, day => number(day, 1, 7, true) as WeekDay, 7);
  if (new Set(result).size !== result.length) throw new ContentError('可用星期不能重复。');
  return result.sort((a, b) => a - b);
}
function date(value: unknown): string {
  const input = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(input) || !Number.isFinite(Date.parse(input))) throw new ContentError('训练日期须为 YYYY-MM-DD 或带时区的 ISO 时间。');
  const calendarDate = input.slice(0, 10);
  if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) throw new ContentError('训练日期不存在。');
  if (input.length > 10 && (Number(input.slice(11, 13)) > 23 || Number(input.slice(14, 16)) > 59 || Number(input.slice(17, 19)) > 59)) throw new ContentError('训练时间不存在。');
  return input;
}
const kinds = ['coach', 'machine', 'partner', 'gym'] as const;
function observation(value: unknown): Observation {
  const input = trainingObject(value);
  return { id: id(input.id), atSeconds: number(input.atSeconds, 0, 86_400), kind: enumValue(input.kind, ['visible', 'hypothesis']), text: text(input.text), source: enumValue(input.source, ['self', 'coach', 'ai']), confidence: enumValue(input.confidence, ['low', 'medium', 'high']) };
}
function workout(value: unknown): GymWorkout {
  const input = trainingObject(value);
  return {
    id: id(input.id), date: date(input.date), title: text(input.title, 200), source: enumValue(input.source, ['manual', 'csv', 'json', 'hevy', 'xunji', 'strong', 'generic-json']), sourceId: input.sourceId === null ? null : text(input.sourceId, 200), notes: text(input.notes),
    ...(input.durationSeconds === undefined ? {} : { durationSeconds: optionalNumber(input.durationSeconds, 0, 86_400) }),
    sets: uniqueIds(list(input.sets, item => {
      const set = trainingObject(item);
      return { id: id(set.id), exercise: text(set.exercise, 200), reps: optionalNumber(set.reps, 0, 10_000, true), weightKg: optionalNumber(set.weightKg, 0, 2000), durationSeconds: optionalNumber(set.durationSeconds, 0, 86_400), rpe: optionalNumber(set.rpe, 0, 10),
        ...(set.index === undefined ? {} : { index: number(set.index, 0, 10_000, true) }), ...(set.type === undefined ? {} : { type: text(set.type, 100) }), ...(set.distanceMeters === undefined ? {} : { distanceMeters: optionalNumber(set.distanceMeters, 0, 1_000_000) }) };
    }, 1000)),
  };
}
export function validatePracticeRate(value: unknown): PracticeRate {
  const input = trainingObject(value);
  return { id: id(input.id), label: text(input.label, 200), kind: enumValue(input.kind, kinds), priceCny: optionalNumber(input.priceCny), billing: enumValue(input.billing, ['session', 'hour']), durationMinutes: number(input.durationMinutes, 1, 1440, true), minimumMinutes: number(input.minimumMinutes, 1, 1440, true), courtIncluded: enumValue(input.courtIncluded, ['yes', 'no', 'unknown']), courtFeeCny: optionalNumber(input.courtFeeCny), courtBilling: enumValue(input.courtBilling, ['session', 'hour']), courtSplit: number(input.courtSplit, 1, 100, true), travelMinutes: optionalNumber(input.travelMinutes, 0, 1440, true), availableDays: days(input.availableDays), notes: text(input.notes) };
}
function candidate(value: unknown): PlanCandidate {
  const input = trainingObject(value);
  if (input.feasible !== null && typeof input.feasible !== 'boolean') throw new ContentError('计划可行性无效。');
  const visits = list(input.visits, value => {
    const visit = trainingObject(value);
    return { rateId: id(visit.rateId), kind: enumValue(visit.kind, kinds), day: visit.day === null ? null : number(visit.day, 1, 7, true) as WeekDay, minutes: number(visit.minutes, 1, 1440, true), costCny: optionalNumber(visit.costCny), totalMinutes: optionalNumber(visit.totalMinutes, 1, 2880, true), warnings: list(visit.warnings, warning => text(warning, 500), 20) };
  }, 7);
  const usedDays = visits.flatMap(visit => visit.day === null ? [] : [visit.day]);
  if (new Set(usedDays).size !== usedDays.length) throw new ContentError('同一天最多安排一次训练。');
  return { id: text(input.id, 100), label: text(input.label, 200), rationale: text(input.rationale), visits, totalCostCny: optionalNumber(input.totalCostCny), totalMinutes: optionalNumber(input.totalMinutes, 0, 20_160, true), feasible: input.feasible as boolean | null, warnings: list(input.warnings, warning => text(warning, 500), 30) };
}
export function validateTrainingState(value: unknown): TrainingState {
  const input = trainingObject(value), profile = trainingObject(input.profile);
  if (input.schemaVersion !== 1) throw new ContentError('训练数据版本不受支持。');
  let lessons: TrainingState['lessons'];
  try { lessons = uniqueIds(list(input.lessons === undefined ? [] : input.lessons, validateTeachingLesson, 200)); }
  catch (error) { throw new ContentError((error as Error).message); }
  const pinnedLessonId = input.pinnedLessonId === undefined ? null : optionalId(input.pinnedLessonId);
  if (pinnedLessonId && !lessons.some(lesson => lesson.id === pinnedLessonId)) throw new ContentError('固定的教学资料已经不存在。');
  const reviews = uniqueIds(list(input.reviews, value => {
    const review = trainingObject(value);
    const durationSeconds = optionalNumber(review.durationSeconds, 0, 86_400);
    const observations = uniqueIds(list(review.observations, observation, 200));
    if (durationSeconds !== null && observations.some(item => item.atSeconds > durationSeconds)) throw new ContentError('观察时间点不能超过录像时长。');
    return { id: id(review.id), date: date(review.date), title: text(review.title, 200), stroke: enumValue(review.stroke, ['forehand', 'backhand', 'serve', 'volley', 'footwork']), feed: enumValue(review.feed, ['machine', 'partner', 'coach', 'self']), camera: enumValue(review.camera, ['side', 'rear', 'front', 'other']), conditions: text(review.conditions), mediaId: optionalId(review.mediaId), durationSeconds, observations, coachRevisions: uniqueIds(list(review.coachRevisions, item => { const note = trainingObject(item); return { id: id(note.id), date: date(note.date), note: text(note.note) }; }, 200)), cue: text(review.cue), drill: text(review.drill), successMetric: text(review.successMetric), previousReviewId: optionalId(review.previousReviewId) };
  }, 1000));
  let currentTask: TrainingState['currentTask'] = null;
  if (input.currentTask !== null) {
    const task = trainingObject(input.currentTask);
    currentTask = { id: id(task.id), reviewId: optionalId(task.reviewId), cue: text(task.cue), drill: text(task.drill), successMetric: text(task.successMetric), sourceCardId: task.sourceCardId === null ? null : text(task.sourceCardId, 300), createdAt: date(task.createdAt), status: enumValue(task.status, ['active', 'done']) };
  }
  const sessions = uniqueIds(list(input.sessions, value => {
    const session = trainingObject(value), successes = optionalNumber(session.successes, 0, 100_000, true), attempts = optionalNumber(session.attempts, 1, 100_000, true);
    if ((successes === null) !== (attempts === null)) throw new ContentError('成功次数和总次数须同时填写，或同时留空。');
    if (successes !== null && attempts !== null && successes > attempts) throw new ContentError('成功次数不能超过总次数。');
    const metric = text(session.metric, 500);
    if (attempts !== null && !metric) throw new ContentError('记录成功次数时，请说明成功标准。');
    return { id: id(session.id), date: date(session.date), kind: enumValue(session.kind, kinds), minutes: number(session.minutes, 1, 1440, true), costCny: optionalNumber(session.costCny), exertion: optionalNumber(session.exertion, 1, 10), taskId: optionalId(session.taskId), successes, attempts, metric, notes: text(session.notes) };
  }, 2000));
  let weekPlan: TrainingState['weekPlan'] = null;
  if (input.weekPlan !== null) {
    const plan = trainingObject(input.weekPlan);
    weekPlan = { ...candidate(plan), weekOf: date(plan.weekOf), notes: text(plan.notes) };
  }
  for (const review of reviews) if (review.previousReviewId === review.id) throw new ContentError('复测不能引用自身。');
  return { schemaVersion: 1, profile: { name: text(profile.name, 100), level: text(profile.level, 200), goals: text(profile.goals), dominantHand: enumValue(profile.dominantHand, ['right', 'left']), weeklyBudgetCny: optionalNumber(profile.weeklyBudgetCny), weeklyAvailableMinutes: optionalNumber(profile.weeklyAvailableMinutes, 1, 10_080, true), maxCourtSessions: optionalNumber(profile.maxCourtSessions, 0, 7, true), availableDays: days(profile.availableDays), gymExperience: text(profile.gymExperience), equipment: list(profile.equipment, equipment => text(equipment, 100), 50), constraints: text(profile.constraints) }, reviews, currentTask, sessions, workouts: uniqueIds(list(input.workouts, workout, 2000)), rates: uniqueIds(list(input.rates, validatePracticeRate, 40)), weekPlan, lessons, pinnedLessonId };
}
