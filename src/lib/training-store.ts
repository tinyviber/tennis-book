import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWrite, ContentError, dataRoot, isBlobStorage, isMissing, MAX_DOCUMENT_BYTES, readDataFile, revisionOf, serialized } from './runtime-store';
import { listTrainingMedia, MAX_TRAINING_MEDIA_BYTES, trainingMediaExists } from './training-media';
import { readTrainingSourceCards } from './training-sources';
import { trainingObject, validateTrainingState } from './training-validation';
import type { PracticeRate, TrainingBootstrap, TrainingDocument, TrainingExport, TrainingState } from './training-types';
import { MAX_TRAINING_EXPORT_BYTES } from './training-limits';
import { publicPath } from './urls';

export const trainingRoot = () => path.join(dataRoot(), 'training');
const statePath = () => path.join(trainingRoot(), 'state.json');
export const MAX_TRAINING_STATE_BYTES = MAX_DOCUMENT_BYTES;
export class TrainingStateCorruptError extends ContentError {
  constructor() {
    super('训练记录文件损坏。请从备份恢复；恢复前会保留原始文件。', 500);
    this.name = 'TrainingStateCorruptError';
  }
}

export function emptyTrainingState(): TrainingState {
  const rates: PracticeRate[] = [
    { id: '11111111-1111-4111-8111-111111111111', label: '我的私教', kind: 'coach', priceCny: null, billing: 'session', durationMinutes: 60, minimumMinutes: 60, courtIncluded: 'unknown', courtFeeCny: null, courtBilling: 'hour', courtSplit: 1, travelMinutes: null, availableDays: [], notes: '' },
    { id: '22222222-2222-4222-8222-222222222222', label: '我的发球机', kind: 'machine', priceCny: null, billing: 'hour', durationMinutes: 60, minimumMinutes: 60, courtIncluded: 'unknown', courtFeeCny: null, courtBilling: 'hour', courtSplit: 1, travelMinutes: null, availableDays: [], notes: '' },
    { id: '33333333-3333-4333-8333-333333333333', label: '球友练习', kind: 'partner', priceCny: null, billing: 'session', durationMinutes: 60, minimumMinutes: 60, courtIncluded: 'no', courtFeeCny: null, courtBilling: 'hour', courtSplit: 2, travelMinutes: null, availableDays: [], notes: '服务费填自己的费用；另付场地费按分摊人数计算。' },
    { id: '44444444-4444-4444-8444-444444444444', label: '我的健身房', kind: 'gym', priceCny: null, billing: 'session', durationMinutes: 45, minimumMinutes: 45, courtIncluded: 'yes', courtFeeCny: null, courtBilling: 'session', courtSplit: 1, travelMinutes: null, availableDays: [], notes: '已有会员且这次无额外费用时，可以填写 0。' },
  ];
  return { schemaVersion: 1, profile: { name: '', level: '初学球友', goals: '让正反手对拉更稳定；每次复盘只调整一个提示。', dominantHand: 'right', weeklyBudgetCny: null, weeklyAvailableMinutes: null, maxCourtSessions: null, availableDays: [], gymExperience: '', equipment: [], constraints: '' }, reviews: [], currentTask: null, sessions: [], workouts: [], rates, weekPlan: null, lessons: [], pinnedLessonId: null };
}

async function storedState() {
  try { return await readDataFile(statePath()); } catch (error) { if (isMissing(error)) return null; throw error; }
}
export async function readTrainingState(): Promise<TrainingDocument> {
  const current = await storedState();
  if (!current) return { state: emptyTrainingState(), revision: null };
  try {
    if (current.bytes.length > MAX_TRAINING_STATE_BYTES) throw new TrainingStateCorruptError();
    return { state: validateTrainingState(JSON.parse(current.bytes.toString('utf8'))), revision: revisionOf(current.bytes) };
  } catch { throw new TrainingStateCorruptError(); }
}
/** Obtain a CAS revision even when the records cannot be parsed; never replace damaged data with defaults. */
export async function readTrainingRecovery(): Promise<{ revision: string | null }> {
  const current = await storedState();
  return { revision: current ? revisionOf(current.bytes) : null };
}
export async function readTrainingBootstrap(): Promise<TrainingBootstrap> {
  const [document, media, sourceCards] = await Promise.all([readTrainingState(), listTrainingMedia(), readTrainingSourceCards()]);
  const localModel = await fs.access(path.join(process.cwd(), 'public/training-vision/pose_landmarker_lite.task')).then(() => true, () => false);
  const poseModelUrl = process.env.TRAINING_POSE_MODEL_URL || (localModel ? publicPath('/training-vision/pose_landmarker_lite.task') : 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task');
  return { ...document, media, sourceCards, capabilities: { storageDriver: isBlobStorage() ? 'vercel-blob' : 'local', maxMediaBytes: MAX_TRAINING_MEDIA_BYTES, aiConfigured: !!process.env.OPENAI_API_KEY, poseModelUrl } };
}

async function writeState(state: TrainingState, expectedRevision: string | null): Promise<TrainingDocument> {
  const current = await storedState();
  if ((current ? revisionOf(current.bytes) : null) !== expectedRevision) throw new ContentError('训练记录已被更新。请保留当前草稿，读取最新版本后再保存。', 409);
  const bytes = JSON.stringify(state, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > MAX_TRAINING_STATE_BYTES) throw new ContentError('训练记录不能超过 2 MB，请先导出并整理旧记录。', 413);
  if (current) await atomicWrite(path.join(trainingRoot(), 'history', `${Date.now()}-${randomUUID()}.json`), current.bytes, { ifAbsent: true });
  await atomicWrite(statePath(), bytes, current ? { ifMatch: current.etag } : { ifAbsent: true });
  // Use the bytes just written: another Blob instance may save immediately after this request.
  return { state, revision: revisionOf(bytes) };
}
export async function saveTrainingState(input: unknown, expectedRevision: string | null): Promise<TrainingDocument> {
  const state = validateTrainingState(input);
  await validateLessonMediaTypes(state);
  return serialized('training:state', () => writeState(state, expectedRevision));
}
async function validateLessonMediaTypes(state: TrainingState) {
  if (!state.lessons.length) return;
  const assets = new Map((await listTrainingMedia()).map(asset => [asset.id, asset]));
  for (const lesson of state.lessons) {
    const video = lesson.mediaId ? assets.get(lesson.mediaId) : null;
    if (video && (video.status !== 'ready' || !video.contentType.startsWith('video/'))) throw new ContentError('教学原片必须关联已上传的视频。');
    for (const step of lesson.steps) {
      const gif = step.gifMediaId ? assets.get(step.gifMediaId) : null;
      if (gif && (gif.status !== 'ready' || gif.contentType !== 'image/gif')) throw new ContentError('步骤 GIF 必须关联已上传的 GIF 文件。');
    }
  }
}
export async function exportTrainingRecords(): Promise<TrainingExport> {
  const [document, media] = await Promise.all([readTrainingState(), listTrainingMedia()]);
  const value: TrainingExport = { format: 'tennis-training-records', version: 1, exportedAt: new Date().toISOString(), state: document.state, media, mediaIncluded: false };
  if (Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8') > MAX_TRAINING_EXPORT_BYTES) throw new ContentError('训练备份超过 4 MB，请先另外备份存储目录并整理旧记录或素材索引。', 413);
  return value;
}
export async function restoreTrainingRecords(input: unknown, expectedRevision: string | null): Promise<TrainingDocument & { warnings: string[] }> {
  const backup = trainingObject(input);
  if (backup.format !== 'tennis-training-records' || backup.version !== 1 || backup.mediaIncluded !== false) throw new ContentError('请选择本系统导出的记录备份；此备份格式不包含录像文件。');
  const state = validateTrainingState(backup.state);
  await validateLessonMediaTypes(state);
  const referenced = [...new Set([...state.reviews.flatMap(review => review.mediaId ? [review.mediaId] : []), ...state.lessons.flatMap(lesson => [...(lesson.mediaId ? [lesson.mediaId] : []), ...lesson.steps.flatMap(step => step.gifMediaId ? [step.gifMediaId] : [])])])];
  const checked = await Promise.all(referenced.map(async id => ({ id, exists: await trainingMediaExists(id) })));
  const missing = checked.filter(item => !item.exists);
  const document = await serialized('training:state', () => writeState(state, expectedRevision));
  return { ...document, warnings: ['此备份只恢复训练记录和教学卡片。录像与 GIF 文件需单独备份与恢复。', ...(missing.length ? [`${missing.length} 个录像或 GIF 素材在当前存储中缺失；记录已保留，可重新上传并关联。`] : [])] };
}
