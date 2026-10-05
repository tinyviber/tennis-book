import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { authConfigured } from '../src/lib/auth-store';
import { ContentError, isGitContentDeployment, readBookDocument, readPublishedBooks } from '../src/lib/content-store';
import {
  ContentError as RuntimeContentError,
  atomicWrite as writeRuntimeFile, isBlobStorage, listDataEntries as listRuntimeEntries,
  readDataFile as readRuntimeFile, removeDataFile as removeRuntimeFile,
} from '../src/lib/runtime-store';

const envKeys = ['DATA_DIR', 'VERCEL', 'STORAGE_DRIVER', 'BLOB_READ_WRITE_TOKEN', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'NEXT_PUBLIC_BASE_PATH'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const dummyHash = `scrypt:${'1'.repeat(32)}:${'2'.repeat(128)}`;
let tempRoot: string, bookSlug: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tennis-git-content-runtime-'));
  bookSlug = `git-book-${randomUUID()}`;
  const bookRoot = path.join(tempRoot, 'books', bookSlug);
  await fs.mkdir(path.join(bookRoot, 'chapters'), { recursive: true });
  await fs.writeFile(path.join(bookRoot, 'book.json'), JSON.stringify({ title: 'Git 书库回归样本', published: true, cover: './images/step.png' }));
  await fs.writeFile(path.join(bookRoot, 'chapters', '01-step.md'), '---\ntitle: 动作说明\norder: 1\npublished: true\n---\n\n来自仓库的正文。\n\n![动作](../images/step.png)\n');
  // Production functions receive the generated index, while image bytes are static assets.
  await fs.writeFile(path.join(bookRoot, 'image-index.json'), JSON.stringify({ 'step.png': { width: 2, height: 3, type: 'png' } }));
  process.env.DATA_DIR = tempRoot;
  process.env.VERCEL = '1';
  process.env.STORAGE_DRIVER = 'vercel-blob';
  process.env.BLOB_READ_WRITE_TOKEN = 'deliberately-invalid-test-token';
  process.env.ADMIN_USERNAME = 'migration-test-owner';
  process.env.ADMIN_PASSWORD_HASH = dummyHash;
  process.env.NEXT_PUBLIC_BASE_PATH = '/tennis';
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('Vercel reads Git book metadata and generated image indexes without valid Blob configuration', async () => {
  assert.equal(isGitContentDeployment(), true);
  assert.equal(isBlobStorage(), true, 'Only private runtime data selects Blob on Vercel');
  const document = await readBookDocument(bookSlug);
  assert.equal(document.metadata.title, 'Git 书库回归样本');
  assert.match(document.revision, /^[a-f0-9]{64}$/);
  const books = await readPublishedBooks();
  assert.equal(books.length, 1);
  assert.equal(books[0].chapterCount, 1);
  assert.equal(books[0].cover, `/tennis/books/${bookSlug}/images/step.png`);
  assert.match(books[0].chapters[0].html, /来自仓库的正文/);
  assert.ok(books[0].chapters[0].html.includes(`src="/tennis/books/${bookSlug}/images/step.png"`));
  assert.match(books[0].chapters[0].html, /width="2" height="3"/);
  assert.doesNotMatch(JSON.stringify(books), /deliberately-invalid-test-token|blob\.vercel|[?&](token|signature)=/);
  await assert.rejects(fs.access(path.join(tempRoot, 'training')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(tempRoot, 'auth')), { code: 'ENOENT' });
});

test('Git book deployments retain configured private-training authentication without private I/O', () => {
  assert.equal(authConfigured(), true);
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.equal(authConfigured(), false);
  assert.equal(RuntimeContentError, ContentError, 'API handlers recognize errors from both storage modules');
});

test('private runtime CRUD refuses Git book paths and paths outside the data directory', async () => {
  process.env.VERCEL = '0'; process.env.STORAGE_DRIVER = 'local';
  const metadataPath = path.join(tempRoot, 'books', bookSlug, 'book.json');
  const original = await fs.readFile(metadataPath);
  const outside = path.join(tempRoot, '..', `outside-${randomUUID()}.json`);
  const forbidden = [metadataPath, outside, path.join(tempRoot, 'training', '..', 'books', bookSlug, 'book.json')];
  const boundaryError = (error: unknown) => error instanceof ContentError && error.status === 400;
  for (const file of forbidden) {
    await assert.rejects(readRuntimeFile(file), boundaryError);
    await assert.rejects(writeRuntimeFile(file, 'private data must not overwrite a book'), boundaryError);
    await assert.rejects(removeRuntimeFile(file), boundaryError);
  }
  await assert.rejects(listRuntimeEntries(path.join(tempRoot, 'books')), boundaryError);
  assert.deepEqual(await fs.readFile(metadataPath), original);
  await assert.rejects(fs.access(outside), { code: 'ENOENT' });
});

test('book management routes use the Git deployment write guard before calling storage', async () => {
  const routes = [
    'src/app/api/admin/books/route.ts',
    'src/app/api/admin/books/[book]/route.ts',
    'src/app/api/admin/books/[book]/chapters/[chapter]/route.ts',
    'src/app/api/admin/books/[book]/images/route.ts',
  ];
  for (const route of routes) {
    const source = await fs.readFile(path.resolve(route), 'utf8');
    assert.match(source, /requireBookAdmin/);
  }
  const persisted = JSON.parse(await fs.readFile(path.join(tempRoot, 'books', bookSlug, 'book.json'), 'utf8'));
  assert.equal(persisted.title, 'Git 书库回归样本');
  await assert.rejects(fs.access(path.join(tempRoot, 'auth')), { code: 'ENOENT' });
});
