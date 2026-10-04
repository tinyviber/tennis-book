import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContentError, dataRoot, getEditorBook, parseChapter, readBook, readPublishedBooks, renderChapter, saveBook, saveChapter, trashContent, uploadImage } from '../src/lib/content-store';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fS8AAAAASUVORK5CYII=', 'base64');
const source = (body: string, published = true) => `---\ntitle: 测试章节\norder: 1\ngroup: 正文\npublished: ${published}\n---\n\n${body}\n`;
beforeEach(async () => { process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'shujian-content-')); });
afterEach(async () => { await fs.rm(dataRoot(), { recursive: true, force: true }); delete process.env.DATA_DIR; });
test('runtime updates, drafts, ordering and safe HTML rendering', async () => {
  await saveBook('test-book', { title: '测试书', published: true }, null);
  await saveChapter('test-book', '01-public', source('第一版'), null);
  await saveChapter('test-book', '02-draft', source('未公开内容', false), null);
  assert.equal((await readPublishedBooks())[0].chapterCount, 1);
  const document = (await getEditorBook('test-book')).chapters.find(item => item.slug === '01-public')!;
  await saveChapter('test-book', document.slug, source('第二版 <script>alert(1)</script>'), document.revision);
  const updated = await readBook('test-book');
  assert.match(updated!.chapters[0].html, /第二版/);
  assert.doesNotMatch(updated!.chapters[0].html, /<script>/);
  assert.ok(updated!.chapters[0].html.includes('&lt;script&gt;'));
  const metadata = await getEditorBook('test-book');
  await saveBook('test-book', { ...metadata.metadata, published: false }, metadata.revision);
  assert.equal(await readBook('test-book'), null);
  assert.equal((await readPublishedBooks()).length, 0);
  assert.equal((await readBook('test-book', true))!.chapterCount, 2);
});
test('concurrent stale writes fail and original source is backed up', async () => {
  await saveBook('test-book', { title: '测试书' }, null);
  const original = await saveChapter('test-book', '01-public', source('原文'), null);
  const results = await Promise.allSettled([
    saveChapter('test-book', original.slug, source('修改 A'), original.revision),
    saveChapter('test-book', original.slug, source('修改 B'), original.revision),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejection.reason as ContentError).status, 409);
  const history = await fs.readdir(path.join(dataRoot(), 'history', 'test-book'));
  assert.equal(history.length, 1);
  assert.equal(await fs.readFile(path.join(dataRoot(), 'history', 'test-book', history[0]), 'utf8'), original.source);
  await assert.rejects(saveBook('test-book', { title: '重复' }, null), (error: unknown) => error instanceof ContentError && error.status === 409);
});
test('validated image uploads, relative references and path boundaries', async () => {
  await saveBook('test-book', { title: '测试书' }, null);
  const image = await uploadImage('test-book', 'original.png', png);
  const rendered = await renderChapter('test-book', '01-public', source(`![说明](${image.reference} "图注")`));
  assert.equal(rendered.figureCount, 1);
  assert.match(rendered.html, /\/media\/test-book\//);
  assert.match(rendered.html, /width="1" height="1"/);
  await fs.writeFile(path.join(dataRoot(), 'books', 'test-book', 'images', image.name), Buffer.from('invalid replacement'));
  await assert.rejects(renderChapter('test-book', '01-public', source(`![替换图片](${image.reference})`)));
  await assert.rejects(uploadImage('test-book', 'bad.png', Buffer.from('not an image')));
  await assert.rejects(uploadImage('test-book', 'bad.webp', png));
  await assert.rejects(renderChapter('test-book', '01-public', source('![越界](../images/%2e%2e%2fsecret.png)')));
  await assert.rejects(renderChapter('test-book', '01-public', source('![远程](https://example.com/photo.png)')));
  await assert.rejects(saveBook('../escape', { title: '无效' }, null));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'shujian-outside-'));
  try {
    await fs.writeFile(path.join(external, 'outside.png'), png);
    await fs.symlink(path.join(external, 'outside.png'), path.join(dataRoot(), 'books', 'test-book', 'images', 'outside.png'));
    await assert.rejects(renderChapter('test-book', '01-public', source('![越界](../images/outside.png)')));
  } finally { await fs.rm(external, { recursive: true, force: true }); }
});
test('reject executable front matter and malformed fields', () => {
  assert.throws(() => parseChapter('test', '---javascript\n({ title: "unsafe" })\n---\nText'));
  assert.throws(() => parseChapter('test', '---\ntitle: X\norder: nope\n---\nText'));
  assert.throws(() => parseChapter('test', '---\ntitle: X\npageStart: 10\npageEnd: 1\n---\nText'));
});
test('removing content preserves recoverable data in trash', async () => {
  const book = await saveBook('test-book', { title: '测试书' }, null);
  const chapter = await saveChapter('test-book', '01-public', source('待回收正文'), null);
  await trashContent('test-book', chapter.slug, chapter.revision);
  assert.equal((await getEditorBook('test-book')).chapters.length, 0);
  let trash = await fs.readdir(path.join(dataRoot(), 'trash'));
  assert.equal(await fs.readFile(path.join(dataRoot(), 'trash', trash[0], 'test-book', '01-public.md'), 'utf8'), chapter.source);
  await trashContent('test-book', null, book.revision);
  assert.equal(await readBook('test-book'), null);
  trash = await fs.readdir(path.join(dataRoot(), 'trash'));
  assert.equal(trash.length, 2);
});
