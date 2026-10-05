import type { TeachingLesson, TeachingStep } from './training-types';

/** Browser-safe validation shared by editable cards, imports and server persistence. */
export type LessonAnalysis = { summary: string; steps: TeachingStep[]; limitations: string[]; insufficientEvidence: boolean };
export const MAX_LESSON_TEXT = 30_000;
export const lessonCategories = ['forehand', 'backhand', 'serve', 'volley', 'footwork', 'conditioning', 'other'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('教学资料须为对象。');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`教学文字不能超过 ${max} 字。`);
  return value.trim();
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('教学资料标识无效。');
  return value.toLowerCase();
}
function nullableId(value: unknown): string | null { return value === null ? null : uuid(value); }
function seconds(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 86_400) throw new Error('教学时间须为 0–86400 的有限秒数。');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error('教学资料选项无效。');
  return value as T;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result)) || Number(result.slice(11, 13)) > 23 || Number(result.slice(14, 16)) > 59 || Number(result.slice(17, 19)) > 59 || new Date(`${result.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== result.slice(0, 10)) throw new Error('教学资料须包含有效的带时区更新时间。');
  return result;
}
export function validateTeachingLesson(value: unknown): TeachingLesson {
  const input = object(value);
  let sourceUrl: string | null = null;
  if (input.sourceUrl !== null) {
    sourceUrl = text(input.sourceUrl, 2048);
    let parsed: URL;
    try { parsed = new URL(sourceUrl); } catch { throw new Error('来源链接须为完整的 HTTP 或 HTTPS 地址。'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('来源链接须为无凭据的 HTTP 或 HTTPS 地址。');
  }
  const sourceText = text(input.sourceText, MAX_LESSON_TEXT);
  const durationSeconds = seconds(input.durationSeconds), mediaId = nullableId(input.mediaId);
  if (!Array.isArray(input.steps) || input.steps.length > 24) throw new Error('一份教学资料最多 24 步。');
  const steps: TeachingStep[] = input.steps.map(value => {
    const item = object(value);
    const startSeconds = seconds(item.startSeconds), endSeconds = seconds(item.endSeconds), evidenceAtSeconds = seconds(item.evidenceAtSeconds);
    if ((startSeconds === null) !== (endSeconds === null) || startSeconds !== null && endSeconds !== null && (!mediaId || durationSeconds === null || endSeconds <= startSeconds || endSeconds > durationSeconds)) throw new Error('循环片段须关联已知时长的视频，起止时间成对填写且不能超过原片。');
    if (evidenceAtSeconds !== null && durationSeconds !== null && evidenceAtSeconds > durationSeconds) throw new Error('证据时间点不能超过原片时长。');
    const sourceQuote = text(item.sourceQuote, 1500);
    if (sourceQuote && !sourceText.includes(sourceQuote)) throw new Error('来源原句必须存在于这份资料的正文或字幕中。');
    const origin = choice(item.origin, ['manual', 'ai', 'import'] as const);
    if (origin === 'ai' && !sourceQuote && evidenceAtSeconds === null) throw new Error('AI 步骤须有来源原句或所选帧证据。');
    if (typeof item.confirmed !== 'boolean') throw new Error('请标明步骤是否已经核对。');
    const title = text(item.title, 200);
    if (!title) throw new Error('请填写步骤标题。');
    const gifMediaId = nullableId(item.gifMediaId);
    if (gifMediaId && (startSeconds === null || endSeconds === null || endSeconds - startSeconds > 6)) throw new Error('保存的 GIF 须关联不超过 6 秒的原片区间。');
    return { id: uuid(item.id), title, cue: text(item.cue, 500), instructions: text(item.instructions, 4000), repetitions: text(item.repetitions, 500), sourceQuote, evidenceAtSeconds, startSeconds, endSeconds, gifMediaId, origin, confirmed: item.confirmed };
  });
  if (new Set(steps.map(step => step.id)).size !== steps.length) throw new Error('步骤标识不能重复。');
  const title = text(input.title, 200);
  if (!title) throw new Error('请填写教学资料标题。');
  return { id: uuid(input.id), title, category: choice(input.category, lessonCategories), sourceKind: choice(input.sourceKind, ['article', 'video', 'notes'] as const), sourceUrl, sourceText, mediaId, durationSeconds, summary: text(input.summary, 4000), steps, createdAt: date(input.createdAt), updatedAt: date(input.updatedAt) };
}

/** External AI drafts cannot bind existing private media or override a lesson's source. */
export function parseTeachingDraft(value: unknown, lesson: TeachingLesson): LessonAnalysis {
  const input = object(value);
  if (input.format !== 'tennis-teaching-draft' || input.version !== 1) throw new Error('请选择 tennis-teaching-draft 第 1 版 JSON。');
  if (!Array.isArray(input.steps) || input.steps.length > 24) throw new Error('教学草稿最多 24 步。');
  const steps = input.steps.map(value => {
    const step = object(value);
    return { id: crypto.randomUUID(), title: step.title, cue: step.cue ?? '', instructions: step.instructions ?? '', repetitions: step.repetitions ?? '', sourceQuote: step.sourceQuote ?? '', evidenceAtSeconds: step.evidenceAtSeconds ?? null, startSeconds: step.startSeconds ?? null, endSeconds: step.endSeconds ?? null, gifMediaId: null, origin: 'import', confirmed: false };
  });
  const validated = validateTeachingLesson({ ...lesson, summary: input.summary ?? '', steps });
  const limitations = input.limitations ?? [];
  if (!Array.isArray(limitations) || limitations.length > 10 || input.insufficientEvidence !== undefined && typeof input.insufficientEvidence !== 'boolean') throw new Error('教学草稿说明格式无效。');
  return { summary: validated.summary, steps: validated.steps, limitations: limitations.map(item => text(item, 1000)), insufficientEvidence: input.insufficientEvidence === true };
}
