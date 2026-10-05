import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContentError, revisionOf } from '../src/lib/content-store';
import { TrainingStateCorruptError, emptyTrainingState, exportTrainingRecords, readTrainingRecovery, readTrainingState, restoreTrainingRecords, saveTrainingState } from '../src/lib/training-store';
import { validateTrainingState } from '../src/lib/training-validation';
import type { Review, TrainingState } from '../src/lib/training-types';

const reviewId = 'bc545523-d238-4c4a-89d7-05f20cc55483';
const missingMediaId = '32bc3b3f-1f40-43c0-9fdb-537246942eae';
const review = (): Review => ({
  id: reviewId, date: '2026-10-04', title: 'Forehand baseline', stroke: 'forehand', feed: 'machine', camera: 'side',
  conditions: 'Same feed and camera position', mediaId: null, durationSeconds: 10, observations: [], coachRevisions: [],
  cue: 'One candidate cue', drill: 'Practice after coach review', successMetric: 'Successful balls / 10 feeds', previousReviewId: null,
});
const conflict = (error: unknown) => error instanceof ContentError && error.status === 409;
let tempRoot: string;
const originalEnv = { DATA_DIR: process.env.DATA_DIR, STORAGE_DRIVER: process.env.STORAGE_DRIVER, VERCEL: process.env.VERCEL };
beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-training-state-'));
  process.env.DATA_DIR = tempRoot;
  process.env.STORAGE_DRIVER = 'local';
  delete process.env.VERCEL;
});
afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('new private state is independent of books and persists user records', async () => {
  const initial = await readTrainingState();
  assert.equal(initial.revision, null);
  assert.equal(initial.state.schemaVersion, 1);
  const state = emptyTrainingState();
  state.profile.name = 'Private owner';
  state.reviews = [review()];
  const saved = await saveTrainingState(state, null);
  assert.match(saved.revision!, /^[a-f0-9]{64}$/);
  const loaded = await readTrainingState();
  assert.equal(loaded.revision, saved.revision);
  assert.equal(loaded.state.profile.name, 'Private owner');
  assert.equal(loaded.state.reviews[0].cue, state.reviews[0].cue);
  assert.equal((await fs.readdir(tempRoot)).includes('books'), false);
});

test('same-revision concurrent writes accept one and never overwrite the winning state', async () => {
  const first = await saveTrainingState(emptyTrainingState(), null);
  const a = structuredClone(first.state), b = structuredClone(first.state);
  a.profile.goals = 'Goal A'; b.profile.goals = 'Goal B';
  const results = await Promise.allSettled([
    saveTrainingState(a, first.revision), saveTrainingState(b, first.revision),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(conflict(rejected.reason));
  const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof saveTrainingState>>>;
  assert.equal((await readTrainingState()).revision, winner.value.revision);
  assert.equal((await readTrainingState()).state.profile.goals, winner.value.state.profile.goals);
  await assert.rejects(saveTrainingState(emptyTrainingState(), null), conflict);
});

test('strict validation rejects non-finite values, invalid dates and impossible success counts', () => {
  const invalid = (change: (state: TrainingState) => void) => {
    const state = emptyTrainingState(); change(state);
    assert.throws(() => validateTrainingState(state));
  };
  invalid(state => { state.profile.weeklyBudgetCny = Infinity; });
  invalid(state => { state.profile.weeklyAvailableMinutes = -1; });
  invalid(state => { state.profile.maxCourtSessions = 1.5; });
  invalid(state => { state.profile.availableDays = [8 as 1]; });
  invalid(state => { const item = review(); item.date = '2026-02-30'; state.reviews = [item]; });
  invalid(state => { state.reviews = [review(), review()]; });
  invalid(state => {
    state.sessions = [{ id: reviewId, date: '2026-10-04', kind: 'machine', minutes: 60, costCny: 0, exertion: null,
      taskId: null, successes: 11, attempts: 10, metric: 'In court', notes: '' }];
  });
  assert.throws(() => validateTrainingState({ ...emptyTrainingState(), schemaVersion: 2 }));
  assert.throws(() => validateTrainingState({ ...emptyTrainingState(), reviews: 'invalid' }));
});

test('invalid saves cannot alter the prior state', async () => {
  const saved = await saveTrainingState(emptyTrainingState(), null);
  const invalid = structuredClone(saved.state); invalid.profile.weeklyBudgetCny = Number.NaN;
  await assert.rejects(saveTrainingState(invalid, saved.revision));
  assert.equal((await readTrainingState()).revision, saved.revision);
});

test('export excludes video binaries and signed credentials; restore preserves missing references with warnings', async () => {
  const state = emptyTrainingState(); state.profile.name = 'Before export';
  const item = review(); item.mediaId = missingMediaId; state.reviews = [item];
  const saved = await saveTrainingState(state, null);
  const backup = await exportTrainingRecords();
  assert.equal(backup.format, 'tennis-training-records');
  assert.equal(backup.version, 1);
  assert.equal(backup.mediaIncluded, false);
  assert.equal(backup.state.reviews[0].mediaId, missingMediaId);
  const encoded = JSON.stringify(backup);
  assert.doesNotMatch(encoded, /[?&](?:token|signature|x-amz-signature|x-vercel-signature)=/i);
  assert.doesNotMatch(encoded, /data:video\/|"(?:bytes|base64|signedUrl|presignedUrl)"/i);
  const changed = structuredClone(saved.state); changed.profile.name = 'After export';
  const current = await saveTrainingState(changed, saved.revision);
  const restored = await restoreTrainingRecords(backup, current.revision);
  assert.equal(restored.state.profile.name, 'Before export');
  assert.equal(restored.state.reviews[0].mediaId, missingMediaId);
  assert.ok(restored.warnings.length > 0);
  await assert.rejects(restoreTrainingRecords(backup, current.revision), conflict);
});

test('restore rejects malformed backup envelopes without replacing current records', async () => {
  const saved = await saveTrainingState(emptyTrainingState(), null);
  await assert.rejects(restoreTrainingRecords({ format: 'other', version: 1, state: saved.state }, saved.revision));
  assert.equal((await readTrainingState()).revision, saved.revision);
});

test('corrupt state exposes a raw recovery revision and restores with a preserved corruption history', async () => {
  const state = emptyTrainingState(); state.profile.name = 'Recoverable owner';
  const saved = await saveTrainingState(state, null);
  const backup = await exportTrainingRecords();
  const corrupt = '{"schemaVersion":1,"profile":';
  await fs.writeFile(path.join(tempRoot, 'training', 'state.json'), corrupt);
  await assert.rejects(readTrainingState(), error => error instanceof TrainingStateCorruptError);
  const recovery = await readTrainingRecovery();
  assert.equal(recovery.revision, revisionOf(Buffer.from(corrupt)));
  await assert.rejects(readTrainingState(), error => error instanceof TrainingStateCorruptError);
  await assert.rejects(restoreTrainingRecords(backup, saved.revision), conflict);
  assert.equal((await readTrainingRecovery()).revision, recovery.revision);
  const restored = await restoreTrainingRecords(backup, recovery.revision);
  assert.equal(restored.state.profile.name, 'Recoverable owner');
  assert.equal((await readTrainingState()).revision, restored.revision);
  const history = await fs.readdir(path.join(tempRoot, 'training', 'history'));
  assert.equal(history.length, 1);
  assert.equal(await fs.readFile(path.join(tempRoot, 'training', 'history', history[0]), 'utf8'), corrupt);
});
