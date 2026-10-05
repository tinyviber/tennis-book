import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContentError } from '../src/lib/content-store';
import { parseTeachingDraft, validateTeachingLesson } from '../src/lib/training-lessons';
import { emptyTrainingState, exportTrainingRecords, readTrainingState, restoreTrainingRecords, saveTrainingState } from '../src/lib/training-store';
import { validateTrainingState } from '../src/lib/training-validation';

const lessonId = 'bc545523-d238-4c4a-89d7-05f20cc55483';
const stepId = '32bc3b3f-1f40-43c0-9fdb-537246942eae';
const missingVideoId = 'f08598a7-ab7e-44f7-9754-d22fc449526f';
const missingGifId = 'ad2b6129-f43c-44f7-ad01-625d7259979a';
const sourceText = '先做分腿垫步，再向来球方向移动。练习时保持身体平衡。';
const step = () => ({
  id: stepId, title: '分腿垫步', cue: '先垫步，再移动', instructions: '先阅读来源，再按教练确认的方式尝试。',
  repetitions: '自行填写练习次数', sourceQuote: '先做分腿垫步', evidenceAtSeconds: null,
  startSeconds: null, endSeconds: null, gifMediaId: null, origin: 'manual', confirmed: true,
});
const lesson = () => ({
  id: lessonId, title: '步法教学', category: 'footwork', sourceKind: 'article',
  sourceUrl: 'https://example.com/tennis/footwork', sourceText, mediaId: null, durationSeconds: null,
  summary: '一个方便在训练时查看的步骤。', steps: [step()], createdAt: '2026-10-05T08:00:00.000Z', updatedAt: '2026-10-05T08:00:00.000Z',
});
const conflict = (error: unknown) => error instanceof ContentError && error.status === 409;
let tempRoot: string;
const originalEnv = { DATA_DIR: process.env.DATA_DIR, STORAGE_DRIVER: process.env.STORAGE_DRIVER, VERCEL: process.env.VERCEL };

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-training-lessons-'));
  process.env.DATA_DIR = tempRoot; process.env.STORAGE_DRIVER = 'local'; delete process.env.VERCEL;
});
afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('old v1 state remains readable and gains an empty lesson library', () => {
  const old: Record<string, unknown> = { ...emptyTrainingState() };
  delete old.lessons; delete old.pinnedLessonId;
  const valid = validateTrainingState(old);
  assert.deepEqual(valid.lessons, []);
  assert.equal(valid.pinnedLessonId, null);
  assert.equal(valid.schemaVersion, 1);
  assert.equal(valid.profile.level, old.profile && (old.profile as { level: string }).level);
});

test('source URLs are HTTP(S) bookmarks and cannot embed credentials or executable schemes', () => {
  const valid = validateTeachingLesson(lesson());
  assert.equal(valid.sourceUrl, lesson().sourceUrl);
  assert.equal(validateTeachingLesson({ ...lesson(), sourceUrl: null }).sourceUrl, null);
  for (const sourceUrl of [
    'javascript:alert(1)', 'data:text/html,secret', 'file:///private/video.mp4',
    'https://username:private-password@example.com/video',
  ]) {
    assert.throws(() => validateTeachingLesson({ ...lesson(), sourceUrl }), sourceUrl);
  }
});

test('lesson ranges are paired finite intervals bounded by the original video', () => {
  const base = { ...lesson(), sourceKind: 'video', mediaId: missingVideoId, durationSeconds: 10 };
  const ranged = { ...step(), evidenceAtSeconds: 4.25, startSeconds: 3.5, endSeconds: 6, sourceQuote: '' };
  const valid = validateTeachingLesson({ ...base, steps: [ranged] });
  assert.equal(valid.steps[0].evidenceAtSeconds, 4.25);
  assert.equal(valid.steps[0].startSeconds, 3.5);
  assert.equal(valid.steps[0].endSeconds, 6);
  for (const values of [
    { startSeconds: null, endSeconds: 6 }, { startSeconds: 3, endSeconds: null },
    { startSeconds: 6, endSeconds: 6 }, { startSeconds: 6, endSeconds: 3 },
    { startSeconds: -1, endSeconds: 2 }, { startSeconds: 8, endSeconds: 11 },
    { startSeconds: Number.NaN, endSeconds: 6 }, { evidenceAtSeconds: Infinity }, { evidenceAtSeconds: 11 },
  ]) {
    assert.throws(() => validateTeachingLesson({ ...base, steps: [{ ...ranged, ...values }] }));
  }
  assert.throws(() => validateTeachingLesson({ ...base, mediaId: null, steps: [ranged] }));
  assert.throws(() => validateTeachingLesson({ ...base, durationSeconds: null, steps: [ranged] }));
  assert.throws(() => validateTeachingLesson({ ...base, steps: [{ ...ranged, startSeconds: 1, endSeconds: 8, gifMediaId: missingGifId }] }));
});

test('lesson validation rejects forged evidence, duplicate IDs and oversized source text', () => {
  assert.throws(() => validateTeachingLesson({ ...lesson(), sourceText: 'x'.repeat(30_001) }));
  assert.throws(() => validateTeachingLesson({ ...lesson(), steps: [{ ...step(), sourceQuote: '原文没有说过的结论' }] }));
  assert.throws(() => validateTeachingLesson({ ...lesson(), steps: [step(), step()] }));
  assert.throws(() => validateTeachingLesson({ ...lesson(), steps: [{ ...step(), origin: 'unknown' }] }));
  assert.throws(() => validateTeachingLesson({ ...lesson(), steps: [{ ...step(), confirmed: 'true' }] }));
  assert.throws(() => validateTrainingState({ ...emptyTrainingState(), lessons: [lesson(), lesson()] }));
});

test('external AI drafts receive fresh IDs and cannot claim adopted status or link private GIFs', () => {
  const current = validateTeachingLesson(lesson());
  const draft = { format: 'tennis-teaching-draft', version: 1, summary: '来源分解草稿', steps: [{ ...step(), origin: 'ai', confirmed: true, gifMediaId: missingGifId }], limitations: [], insufficientEvidence: false };
  const parsed = parseTeachingDraft(draft, current);
  assert.equal(parsed.summary, draft.summary);
  assert.equal(parsed.steps.length, 1);
  assert.notEqual(parsed.steps[0].id, stepId);
  assert.match(parsed.steps[0].id, /^[0-9a-f-]{36}$/i);
  assert.equal(parsed.steps[0].origin, 'import');
  assert.equal(parsed.steps[0].confirmed, false);
  assert.equal(parsed.steps[0].gifMediaId, null);
  assert.equal(current.steps[0].origin, 'manual');
  assert.equal(current.steps[0].confirmed, true);
  assert.throws(() => parseTeachingDraft({ ...draft, steps: [{ ...step(), sourceQuote: 'Unprovided source claim' }] }, current));
  assert.throws(() => parseTeachingDraft({ ...draft, steps: Array.from({ length: 25 }, () => step()) }, current));
});

test('lesson saves participate in CAS and pin only references the current lesson library', async () => {
  const state = emptyTrainingState(); state.lessons = [validateTeachingLesson(lesson())]; state.pinnedLessonId = lessonId;
  const saved = await saveTrainingState(state, null);
  assert.equal((await readTrainingState()).state.pinnedLessonId, lessonId);
  const updated = structuredClone(saved.state); updated.lessons[0].steps[0].cue = '教练修正后的提示';
  const newer = await saveTrainingState(updated, saved.revision);
  await assert.rejects(saveTrainingState(state, saved.revision), conflict);
  assert.equal((await readTrainingState()).state.lessons[0].steps[0].cue, '教练修正后的提示');
  const invalid = structuredClone(newer.state); invalid.pinnedLessonId = missingVideoId;
  await assert.rejects(saveTrainingState(invalid, newer.revision));
  assert.equal((await readTrainingState()).revision, newer.revision);
});

test('lesson exports preserve source and GIF references; restore reports missing teaching media', async () => {
  const state = emptyTrainingState();
  state.lessons = [validateTeachingLesson({ ...lesson(), sourceKind: 'video', mediaId: missingVideoId, durationSeconds: 10, steps: [{ ...step(), startSeconds: 1, endSeconds: 3, gifMediaId: missingGifId }] })];
  state.pinnedLessonId = lessonId;
  const saved = await saveTrainingState(state, null);
  const backup = await exportTrainingRecords();
  assert.equal(backup.state.lessons[0].mediaId, missingVideoId);
  assert.equal(backup.state.lessons[0].steps[0].gifMediaId, missingGifId);
  assert.equal(backup.mediaIncluded, false);
  assert.doesNotMatch(JSON.stringify(backup), /data:video\/|data:image\/|[?&](?:token|signature)=/i);
  const restored = await restoreTrainingRecords(backup, saved.revision);
  assert.equal(restored.state.pinnedLessonId, lessonId);
  assert.equal(restored.state.lessons[0].sourceText, sourceText);
  assert.ok(restored.warnings.some(message => message.includes('2') && /缺失|missing/i.test(message)));
  const history = await fs.readdir(path.join(tempRoot, 'training', 'history'));
  assert.equal(history.length, 1);
});
