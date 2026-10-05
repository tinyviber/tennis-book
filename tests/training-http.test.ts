import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaAsset, TeachingLesson, TrainingBootstrap, TrainingExport } from '../src/lib/training-types';

// Run only against an isolated local server with a disposable DATA_DIR.
// TRAINING_HTTP_TEST_BASE_URL=http://127.0.0.1:PORT
// TRAINING_HTTP_TEST_USERNAME / TRAINING_HTTP_TEST_PASSWORD configure its test account.
const base = process.env.TRAINING_HTTP_TEST_BASE_URL;
const username = process.env.TRAINING_HTTP_TEST_USERNAME;
const password = process.env.TRAINING_HTTP_TEST_PASSWORD;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fS8AAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
function address(relative: string) {
  const target = new URL(base!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'HTTP tests require a disposable local server');
  return `${base!.replace(/\/$/, '')}${relative}`;
}

test('HTTP private records, exports, analysis and media reject unauthenticated access', { skip: !base }, async () => {
  for (const resource of ['/api/training/', '/api/training/export/', '/api/training/media/68b57825-b8d9-4885-b25d-75d599fe14cb/']) {
    const response = await fetch(address(resource), { redirect: 'manual' });
    assert.equal(response.status, 401, resource);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
  for (const resource of ['/api/training/analyze/', '/api/training/lessons/analyze/']) {
    const analysis = await fetch(address(resource), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(analysis.status, 401, resource);
    assert.match(analysis.headers.get('cache-control') || '', /no-store/);
  }
});

test('HTTP authenticated writes enforce Origin, CAS, private Range, export and logout', { skip: !base || !username || !password }, async () => {
  const origin = new URL(base!).origin;
  const login = await fetch(address('/api/auth/login/'), {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert.ok(cookie);
  const auth = { Cookie: cookie };
  const initialResponse = await fetch(address('/api/training/'), { headers: auth });
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json() as TrainingBootstrap;
  assert.equal(initial.capabilities.storageDriver, 'local', 'Range integration tests require the local driver');
  const originalExportResponse = await fetch(address('/api/training/export/'), { headers: auth });
  assert.equal(originalExportResponse.status, 200);
  const originalExport = await originalExportResponse.json() as TrainingExport;
  const state = structuredClone(initial.state); state.profile.goals = 'HTTP test temporary goal';
  const payload = JSON.stringify({ state, revision: initial.revision });
  const csrfHeaders: Record<string, string>[] = [{}, { Origin: 'https://attacker.example.com' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }];
  for (const extra of csrfHeaders) {
    const response = await fetch(address('/api/training/'), {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json', ...extra }, body: payload,
    });
    assert.equal(response.status, 403);
    const analysis = await fetch(address('/api/training/lessons/analyze/'), {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', ...extra }, body: '{}',
    });
    assert.equal(analysis.status, 403, 'teaching analysis validates Origin before input or provider access');
  }
  const savedResponse = await fetch(address('/api/training/'), {
    method: 'PUT', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: payload,
  });
  assert.equal(savedResponse.status, 200);
  let saved = await savedResponse.json() as TrainingBootstrap;
  const stale = await fetch(address('/api/training/'), {
    method: 'PUT', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: payload,
  });
  assert.equal(stale.status, 409);
  const lesson: TeachingLesson = {
    id: crypto.randomUUID(), title: 'HTTP test teaching card', category: 'footwork', sourceKind: 'article',
    sourceUrl: 'https://example.com/tennis/footwork', sourceText: '先做分腿垫步，再移动。', mediaId: null, durationSeconds: null,
    summary: 'HTTP test source breakdown', createdAt: '2026-10-05T08:00:00.000Z', updatedAt: '2026-10-05T08:00:00.000Z',
    steps: [{ id: crypto.randomUUID(), title: '分腿垫步', cue: '先垫步', instructions: '按资料和教练确认后的方式练习。', repetitions: '',
      sourceQuote: '先做分腿垫步', evidenceAtSeconds: null, startSeconds: null, endSeconds: null, gifMediaId: null, origin: 'manual', confirmed: true }],
  };
  const lessonState = structuredClone(saved.state); lessonState.lessons.push(lesson); lessonState.pinnedLessonId = lesson.id;
  const lessonPayload = JSON.stringify({ state: lessonState, revision: saved.revision });
  const lessonSave = await fetch(address('/api/training/'), {
    method: 'PUT', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: lessonPayload,
  });
  assert.equal(lessonSave.status, 200);
  saved = await lessonSave.json() as TrainingBootstrap;
  assert.equal(saved.state.pinnedLessonId, lesson.id);
  assert.equal(saved.state.lessons.find(item => item.id === lesson.id)?.steps[0].cue, '先垫步');
  const staleLesson = await fetch(address('/api/training/'), {
    method: 'PUT', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: lessonPayload,
  });
  assert.equal(staleLesson.status, 409);
  const invalidAnalysis = await fetch(address('/api/training/lessons/analyze/'), {
    method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: false }),
  });
  assert.equal(invalidAnalysis.status, 400, 'refusing consent does not call the provider');
  const form = new FormData(); form.set('file', new File([new Uint8Array(png)], 'Frame.png', { type: 'image/png' }));
  const upload = await fetch(address('/api/training/media/'), { method: 'POST', headers: { ...auth, Origin: origin }, body: form });
  assert.equal(upload.status, 201);
  const asset = await upload.json() as MediaAsset;
  const clip = `/api/training/media/${asset.id}/`;
  const partial = await fetch(address(clip), { headers: { ...auth, Range: 'bytes=1-3' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 1-3/${png.length}`);
  assert.match(partial.headers.get('cache-control') || '', /private.*no-store|no-store.*private/);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), png.subarray(1, 4));
  const badRange = await fetch(address(clip), { headers: { ...auth, Range: `bytes=${png.length}-` } });
  assert.equal(badRange.status, 416);
  assert.equal(badRange.headers.get('content-range'), `bytes */${png.length}`);
  const badPath = await fetch(address('/api/training/media/not-a-uuid/'), { headers: auth });
  assert.equal(badPath.status, 400);
  const gifForm = new FormData(); gifForm.set('file', new File([new Uint8Array(gif)], 'Teaching-loop.gif', { type: 'image/gif' }));
  const gifUpload = await fetch(address('/api/training/media/'), { method: 'POST', headers: { ...auth, Origin: origin }, body: gifForm });
  assert.equal(gifUpload.status, 201);
  const gifAsset = await gifUpload.json() as MediaAsset;
  assert.equal(gifAsset.contentType, 'image/gif');
  const gifPath = `/api/training/media/${gifAsset.id}/`;
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(address(gifPath), { method, headers: auth });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/gif');
    assert.equal(response.headers.get('content-length'), String(gif.length));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control') || '', /private.*no-store|no-store.*private/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, method === 'HEAD' ? Buffer.alloc(0) : gif);
  }
  assert.equal((await fetch(address(gifPath), { redirect: 'manual' })).status, 401);
  const backupResponse = await fetch(address('/api/training/export/'), { headers: auth });
  assert.equal(backupResponse.status, 200);
  const backup = await backupResponse.json() as TrainingExport;
  assert.equal(backup.mediaIncluded, false);
  assert.ok(backup.media.some(item => item.id === asset.id));
  assert.ok(backup.media.some(item => item.id === gifAsset.id));
  assert.equal(backup.state.pinnedLessonId, lesson.id);
  assert.ok(backup.state.lessons.some(item => item.id === lesson.id));
  assert.doesNotMatch(JSON.stringify(backup), /[?&](?:token|signature|x-amz-signature)=|data:video\/|"(?:base64|signedUrl|presignedUrl)"/i);
  const restored = await fetch(address('/api/training/restore/'), {
    method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: originalExport, revision: saved.revision }),
  });
  assert.equal(restored.status, 200);
  const logout = await fetch(address('/api/auth/logout/'), { method: 'POST', headers: { ...auth, Origin: origin } });
  assert.equal(logout.status, 200);
  const revoked = await fetch(address(clip), { headers: { ...auth, Range: 'bytes=1-3' }, redirect: 'manual' });
  assert.equal(revoked.status, 401);
  assert.equal((await fetch(address(gifPath), { headers: auth, redirect: 'manual' })).status, 401);
  assert.equal((await fetch(address('/api/training/export/'), { headers: auth })).status, 401);
});
