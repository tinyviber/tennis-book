import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContentError } from '../src/lib/content-store';
import { MAX_TRAINING_MEDIA_BYTES, listTrainingMedia, parseByteRange, readTrainingMedia, trainingMediaExists, uploadTrainingMedia, validateMediaId, validateMediaUpload } from '../src/lib/training-media';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fS8AAAAASUVORK5CYII=', 'base64');
const status = (expected: number) => (error: unknown) => error instanceof ContentError && error.status === expected;
let tempRoot: string;
const originalEnv = { DATA_DIR: process.env.DATA_DIR, STORAGE_DRIVER: process.env.STORAGE_DRIVER, VERCEL: process.env.VERCEL };
beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-training-media-'));
  process.env.DATA_DIR = tempRoot; process.env.STORAGE_DRIVER = 'local'; delete process.env.VERCEL;
});
afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('media identifiers and metadata cannot address arbitrary paths or accept unbounded uploads', () => {
  for (const id of ['../secret', '%2e%2e%2fsecret', 'books/book/images/test.png', 'not-a-uuid', '']) {
    assert.throws(() => validateMediaId(id));
  }
  for (const name of ['../clip.mp4', 'folder/clip.mp4', 'folder\\clip.mp4', 'clip\u0000.mp4']) {
    assert.throws(() => validateMediaUpload({ name, contentType: 'video/mp4', size: 12 }));
  }
  for (const size of [0, -1, Infinity, 1.5, MAX_TRAINING_MEDIA_BYTES + 1]) {
    assert.throws(() => validateMediaUpload({ name: 'clip.mp4', contentType: 'video/mp4', size }), status(413));
  }
  for (const contentType of ['image/svg+xml', 'text/html', 'application/octet-stream']) {
    assert.throws(() => validateMediaUpload({ name: 'clip.mp4', contentType, size: 12 }), status(415));
  }
});

test('private upload persists bytes and exposes an authenticated application URL', async () => {
  const asset = await uploadTrainingMedia('Frame.png', 'image/png', png);
  assert.equal(asset.status, 'ready');
  assert.equal(asset.size, png.length);
  assert.match(asset.url, new RegExp(`/api/training/media/${asset.id}/$`));
  assert.doesNotMatch(asset.url, /\/media\/[^/]+\/images\/|[?&](?:token|signature)=/);
  assert.equal(await trainingMediaExists(asset.id), true);
  const loaded = await readTrainingMedia(asset.id);
  assert.deepEqual(loaded.bytes, png);
  assert.deepEqual(await listTrainingMedia(), [asset]);
  await assert.rejects(uploadTrainingMedia('Fake.mp4', 'video/mp4', png), status(415));
  await assert.rejects(uploadTrainingMedia('Fake.png', 'image/png', Buffer.from('<html>private</html>')), status(415));
});

test('GIF teaching clips persist privately and reject mismatched media signatures', async () => {
  const gif89 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const gif87 = Buffer.from(gif89); gif87.write('GIF87a', 0, 'ascii');
  for (const [name, bytes] of [['Teaching-89.gif', gif89], ['Teaching-87.gif', gif87]] as const) {
    const asset = await uploadTrainingMedia(name, 'image/gif', bytes);
    assert.equal(asset.status, 'ready'); assert.equal(asset.contentType, 'image/gif');
    assert.match(asset.url, new RegExp(`/api/training/media/${asset.id}/$`));
    assert.doesNotMatch(asset.url, /[?&](?:token|signature)=/);
    assert.deepEqual((await readTrainingMedia(asset.id)).bytes, bytes);
    assert.equal(await trainingMediaExists(asset.id), true);
  }
  await assert.rejects(uploadTrainingMedia('Fake.gif', 'image/gif', png), status(415));
  await assert.rejects(uploadTrainingMedia('Fake.png', 'image/png', gif89), status(415));
  await assert.rejects(uploadTrainingMedia('Fake.gif', 'image/gif', Buffer.from('<html>private</html>')), status(415));
});

test('missing media is distinguishable from valid metadata and never reads beyond the data root', async () => {
  const missing = '68b57825-b8d9-4885-b25d-75d599fe14cb';
  assert.equal(await trainingMediaExists(missing), false);
  await assert.rejects(readTrainingMedia(missing), status(404));
  const asset = await uploadTrainingMedia('Frame.png', 'image/png', png);
  const filename = path.join(tempRoot, 'training', 'media', `${asset.id}.png`);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-training-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.png'), png);
    await fs.unlink(filename);
    await fs.symlink(path.join(outside, 'secret.png'), filename);
    await assert.rejects(readTrainingMedia(asset.id));
  } finally { await fs.rm(outside, { recursive: true, force: true }); }
});

test('tampered persistent media paths fail closed', async () => {
  await uploadTrainingMedia('Frame.png', 'image/png', png);
  const file = path.join(tempRoot, 'training', 'media', 'index.json');
  const index = JSON.parse(await fs.readFile(file, 'utf8'));
  index[0].pathname = 'books/private/images/secret.png';
  await fs.writeFile(file, JSON.stringify(index));
  await assert.rejects(listTrainingMedia(), status(500));
});

test('single byte ranges support normal, open-ended, suffix and clipped requests', () => {
  assert.equal(parseByteRange(null, 10), null);
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=2-', 10), { start: 2, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-20', 10), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange('bytes=2-30', 10), { start: 2, end: 9 });
});

test('malformed, unsatisfiable and multiple byte ranges return 416', () => {
  for (const range of ['bytes=', 'bytes=-', 'bytes=-0', 'bytes=10-', 'bytes=6-2', 'bytes=0-1,3-4', 'bytes=0.5-2', 'items=0-2', 'bytes=999999999999999999999-', 'bytes=-999999999999999999999']) {
    assert.throws(() => parseByteRange(range, 10), status(416));
  }
  assert.throws(() => parseByteRange('bytes=0-', 0), status(416));
});
