import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BlobNotFoundError, BlobPreconditionFailedError, copy, del, get, head, issueSignedToken, list, presignUrl, put } from '@vercel/blob';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import { imageSize } from 'image-size';
import type { Book, BookMetadata, Chapter, ChapterDocument } from './types';
import { publicPath } from './urls';

export class ContentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const dataRoot = () => path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const booksRoot = () => path.join(dataRoot(), 'books');
export const revisionOf = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(webp|png|jpe?g|gif)$/i;
export function validateSlug(value: string): string {
  if (typeof value !== 'string' || value.length > 100 || !slugPattern.test(value)) throw new ContentError('标识只能包含小写字母、数字和连字符，最多 100 个字符。');
  return value;
}
export function validateImageName(value: string): string {
  if (value.length > 180 || !imagePattern.test(value)) throw new ContentError('图片名称或格式不受支持。');
  return value;
}
const bookPath = (slug: string) => path.join(booksRoot(), validateSlug(slug));
export const isBlobStorage = () => process.env.STORAGE_DRIVER === 'vercel-blob' || process.env.VERCEL === '1';
export const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === 'ENOENT' ||
  error instanceof ContentError && error.status === 404 ||
  error instanceof BlobNotFoundError;
type StoredFile = { bytes: Buffer; etag?: string };
export type WriteCondition = { ifMatch?: string; ifAbsent?: boolean };
type BlobItem = { pathname: string; url: string; etag: string };
type DataEntry = { name: string; isDirectory: boolean };

function dataRelativePath(file: string): string | null {
  const root = dataRoot(), target = path.resolve(file), relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}
function blobPath(file: string): string {
  const relative = dataRelativePath(file);
  if (relative === null) throw new ContentError('内容路径越界。');
  return relative;
}
async function listBlobItems(prefix: string): Promise<BlobItem[]> {
  const items: BlobItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    items.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return items;
}
export async function listDataEntries(directory: string): Promise<DataEntry[]> {
  if (!isBlobStorage()) {
    try {
      return (await fs.readdir(directory, { withFileTypes: true })).map(item => ({ name: item.name, isDirectory: item.isDirectory() }));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
  const key = blobPath(directory), prefix = key ? `${key.replace(/\/$/, '')}/` : '';
  const entries = new Map<string, boolean>();
  for (const item of await listBlobItems(prefix)) {
    const relative = item.pathname.slice(prefix.length), slash = relative.indexOf('/');
    const name = slash < 0 ? relative : relative.slice(0, slash);
    if (name) entries.set(name, slash >= 0 || entries.get(name) === true);
  }
  return [...entries].map(([name, isDirectory]) => ({ name, isDirectory })).sort((a, b) => a.name.localeCompare(b.name));
}
export async function readDataFile(file: string): Promise<StoredFile> {
  if (isBlobStorage()) {
    const key = blobPath(file), result = await get(key, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) throw new ContentError('内容不存在。', 404);
    return { bytes: Buffer.from(await new Response(result.stream).arrayBuffer()), etag: result.blob.etag };
  }
  try {
    const [resolved, root] = await Promise.all([fs.realpath(file), fs.realpath(dataRoot())]);
    if (!resolved.startsWith(root + path.sep)) throw new ContentError('内容路径越界。');
    const bytes = await fs.readFile(resolved);
    return { bytes, etag: revisionOf(bytes) };
  } catch (error) {
    if (isMissing(error)) throw new ContentError('内容不存在。', 404);
    throw error;
  }
}
async function readFile(file: string): Promise<Buffer> {
  return (await readDataFile(file)).bytes;
}
async function maybeReadDataFile(file: string): Promise<StoredFile | null> {
  try { return await readDataFile(file); } catch (error) { if (isMissing(error)) return null; throw error; }
}
export async function atomicWrite(file: string, value: string | Buffer, condition?: WriteCondition): Promise<void> {
  if (isBlobStorage() && dataRelativePath(file) !== null) {
    const key = blobPath(file);
    let ifMatch = condition?.ifMatch, allowOverwrite = !condition?.ifAbsent;
    if (!condition) {
      try { ifMatch = (await head(key)).etag; allowOverwrite = true; }
      catch (error) { if (isMissing(error)) allowOverwrite = false; else throw error; }
    }
    try {
      await put(key, value, { access: 'private', addRandomSuffix: false, allowOverwrite, ...(ifMatch ? { ifMatch } : {}) });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (error as Error)?.name === 'BlobAlreadyExistsError' || /already exists/i.test((error as Error)?.message || '')) {
        throw new ContentError('内容已被更新，或标识已存在。请重新加载后再保存。', 409);
      }
      throw error;
    }
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, value, { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
export async function removeDataFile(file: string, etag?: string): Promise<void> {
  if (isBlobStorage()) {
    try {
      const metadata = await head(blobPath(file));
      await del(metadata.url, etag ? { ifMatch: etag } : undefined);
    } catch (error) { if (!isMissing(error)) throw error; }
    return;
  }
  await fs.rm(file, { force: true });
}
export async function signedBlobReadUrl(key: string): Promise<string> {
  const now = Date.now();
  if (!cachedReadToken || cachedReadTokenUntil < now + 20 * 60_000) {
    cachedReadToken = await issueSignedToken({ pathname: '*', operations: ['get'], validUntil: now + 60 * 60 * 1000 });
    cachedReadTokenUntil = now + 60 * 60 * 1000;
  }
  const { presignedUrl } = await presignUrl(cachedReadToken, {
    operation: 'get', pathname: key, access: 'private', validUntil: now + 15 * 60 * 1000,
  });
  return presignedUrl;
}
let cachedReadToken: Awaited<ReturnType<typeof issueSignedToken>> | null = null;
let cachedReadTokenUntil = 0;
// Serialize local writes; Blob writes also use ETags to coordinate across function instances.
const edits = new Map<string, Promise<unknown>>();
export async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = edits.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  edits.set(key, next);
  try { return await next; } finally { if (edits.get(key) === next) edits.delete(key); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('资料格式不正确。');
  return value as Record<string, unknown>;
}
function string(value: unknown, fallback = '', limit = 4000): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > limit) throw new ContentError('文本字段类型或长度不正确。');
  return value.trim();
}
function published(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new ContentError('发布状态必须是布尔值。');
  return value;
}
function page(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100000) throw new ContentError('页码必须是正整数。');
  return value;
}
export function validateMetadata(slug: string, value: unknown): BookMetadata {
  const input = object(value);
  if (input.slug !== undefined && input.slug !== slug) throw new ContentError('书籍标识必须与目录一致。');
  const title = string(input.title, '', 256);
  if (!title) throw new ContentError('请填写书名。');
  const authors = input.authors ?? [];
  if (!Array.isArray(authors) || authors.length > 50) throw new ContentError('作者必须是文本列表。');
  return {
    slug: validateSlug(slug), title, subtitle: string(input.subtitle), description: string(input.description),
    authors: authors.map(author => string(author, '', 256)), language: string(input.language, 'zh-CN', 64),
    translator: string(input.translator), publisher: string(input.publisher), isbn: string(input.isbn, '', 100),
    sourceNote: string(input.sourceNote), cover: string(input.cover, '', 240) || null, published: published(input.published),
  };
}
export function parseChapter(slug: string, source: string) {
  validateSlug(slug);
  if (Buffer.byteLength(source) > MAX_DOCUMENT_BYTES) throw new ContentError('章节不能超过 2 MB。');
  // gray-matter supports executable JavaScript; accept only plain YAML delimiters.
  if (!/^---\r?\n/.test(source)) throw new ContentError('章节必须以 YAML 资料区开始（---）。');
  let parsed;
  try { parsed = matter(source); } catch { throw new ContentError('章节 YAML 资料格式不正确。'); }
  const data = object(parsed.data);
  if (data.slug !== undefined && data.slug !== slug) throw new ContentError('章节标识必须与文件名一致。');
  const title = string(data.title, '', 256);
  if (!title) throw new ContentError('请填写章节标题。');
  const order = data.order ?? 1;
  if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0 || order > 100000) throw new ContentError('章节顺序必须是非负整数。');
  const pageStart = page(data.pageStart), pageEnd = page(data.pageEnd) ?? pageStart;
  if (pageStart === null && pageEnd !== null || pageStart !== null && pageEnd !== null && pageEnd < pageStart) throw new ContentError('结束页码不能小于开始页码。');
  return { data: { slug, title, order, group: string(data.group, '正文', 256), pageStart, pageEnd, published: published(data.published) }, content: parsed.content };
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
type Asset = { name: string; width: number; height: number; type: string; bytes: Buffer };
type ImageInfo = Pick<Asset, 'width' | 'height' | 'type'>;
const imageInfoCache = new Map<string, { signature: string; info: ImageInfo }>();
const blobImageIndexCache = new Map<string, { expiresAt: number; index: Record<string, ImageInfo> }>();
const imageIndexPath = (slug: string) => path.join(bookPath(slug), 'image-index.json');
async function readBlobImageIndex(slug: string, forceRefresh = false): Promise<Record<string, ImageInfo>> {
  const cached = blobImageIndexCache.get(slug);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.index;
  const stored = await maybeReadDataFile(imageIndexPath(slug));
  let index: Record<string, ImageInfo> = {};
  if (stored) {
    try {
      const value = JSON.parse(stored.bytes.toString('utf8')) as Record<string, unknown>;
      for (const [name, item] of Object.entries(value)) {
        if (!imagePattern.test(name) || !item || typeof item !== 'object') continue;
        const info = item as Partial<ImageInfo>;
        if (Number.isSafeInteger(info.width) && Number.isSafeInteger(info.height) && info.width! > 0 && info.height! > 0 && ['webp', 'png', 'jpg', 'gif'].includes(info.type || '')) {
          index[name] = { width: info.width!, height: info.height!, type: info.type! };
        }
      }
    } catch { throw new ContentError('图片索引格式不正确。', 500); }
  }
  if (blobImageIndexCache.size > 100) blobImageIndexCache.clear();
  blobImageIndexCache.set(slug, { expiresAt: Date.now() + 30_000, index });
  return index;
}
async function updateBlobImageIndex(slug: string, name: string, info: ImageInfo): Promise<void> {
  const file = imageIndexPath(slug);
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await maybeReadDataFile(file);
    let index: Record<string, ImageInfo> = {};
    if (current) {
      try { index = JSON.parse(current.bytes.toString('utf8')); }
      catch { throw new ContentError('图片索引格式不正确。', 500); }
    }
    index[name] = info;
    try {
      await atomicWrite(file, JSON.stringify(index), current ? { ifMatch: current.etag } : { ifAbsent: true });
      blobImageIndexCache.set(slug, { expiresAt: Date.now() + 30_000, index });
      return;
    } catch (error) {
      if (!(error instanceof ContentError && error.status === 409)) throw error;
    }
  }
  throw new ContentError('图片库正在被更新，请稍后重试。', 409);
}
export async function readImageInfo(slug: string, name: string): Promise<ImageInfo> {
  validateSlug(slug);
  validateImageName(name);
  if (isBlobStorage()) {
    const info = (await readBlobImageIndex(slug))[name];
    if (info) return info;
    const asset = await readImage(slug, name);
    const generated = { width: asset.width, height: asset.height, type: asset.type };
    await updateBlobImageIndex(slug, name, generated);
    return generated;
  }
  const file = path.join(bookPath(slug), 'images', validateImageName(name));
  let stat;
  try { stat = await fs.stat(file); } catch (error) { if (isMissing(error)) throw new ContentError('引用的图片不存在。', 404); throw error; }
  const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = imageInfoCache.get(file);
  if (cached?.signature === signature) return cached.info;
  const { width, height, type } = await readImage(slug, name);
  const info = { width, height, type };
  if (imageInfoCache.size >= 2000) imageInfoCache.clear();
  imageInfoCache.set(file, { signature, info });
  return info;
}
export async function readImage(slug: string, name: string): Promise<Asset> {
  const { bytes } = await readDataFile(path.join(bookPath(slug), 'images', validateImageName(name)));
  return { name, bytes, ...validateImage(bytes, name) };
}
export function validateImage(bytes: Buffer, name: string) {
  validateImageName(name);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ContentError('图片大小必须在 10 MB 以内。');
  try {
    const dimensions = imageSize(bytes);
    const extension = path.extname(name).slice(1).toLowerCase().replace('jpeg', 'jpg');
    if (!dimensions.width || !dimensions.height || !['webp', 'png', 'jpg', 'gif'].includes(dimensions.type || '') || extension !== dimensions.type) throw new Error('Invalid image');
    if (dimensions.width * dimensions.height > 40_000_000) throw new Error('Image too large');
    return { width: dimensions.width, height: dimensions.height, type: dimensions.type! };
  } catch { throw new ContentError('请上传有效的 WebP、PNG、JPEG 或 GIF 图片（最多 4000 万像素）。'); }
}
function imageReference(reference: string, chapter: boolean): string {
  let decoded;
  try { decoded = decodeURIComponent(reference); } catch { throw new ContentError('图片路径编码无效。'); }
  const prefix = chapter ? '../images/' : './images/';
  if (!decoded.startsWith(prefix) && !(!chapter && decoded.startsWith('images/'))) throw new ContentError(`图片必须使用${chapter ? '../images/图片名' : './images/图片名'}。`);
  return validateImageName(decoded.slice(decoded.startsWith(prefix) ? prefix.length : 'images/'.length));
}
export const imageUrl = (slug: string, name: string) => publicPath(`/media/${validateSlug(slug)}/${encodeURIComponent(validateImageName(name))}/`);
export async function renderChapter(book: string, slug: string, source: string): Promise<Chapter> {
  const { data, content } = parseChapter(slug, source);
  const md = new MarkdownIt({ html: false, linkify: false });
  const tokens = md.parse(content, {});
  const references = new Set<string>();
  function collect(list: typeof tokens) {
    for (const token of list) {
      if (token.type === 'image') references.add(imageReference(String(token.attrGet('src') || ''), true));
      if (token.children) collect(token.children);
    }
  }
  collect(tokens);
  const assets = new Map(await Promise.all([...references].map(async name => [name, await readImageInfo(book, name)] as const)));
  const headings: Chapter['headings'] = [];
  let figureCount = 0;
  md.renderer.rules.image = (list, index) => {
    const token = list[index], name = imageReference(String(token.attrGet('src') || ''), true), asset = assets.get(name)!;
    const alt = token.content, caption = token.attrGet('title');
    figureCount++;
    return `<figure><img src="${escape(imageUrl(book, name))}" alt="${escape(alt)}" width="${asset.width}" height="${asset.height}" loading="lazy" decoding="async" tabindex="0" role="button" aria-label="${escape('放大：' + alt)}"/><figcaption>${escape(alt)}${caption ? '<span>' + escape(String(caption)) + '</span>' : ''}</figcaption></figure>`;
  };
  md.renderer.rules.heading_open = (list, index, options, env, self) => {
    const title = list[index + 1].content, id = `section-${headings.length + 1}`, level = Number(list[index].tag.slice(1));
    list[index].attrSet('id', id);
    headings.push({ id, title, level });
    return self.renderToken(list, index, options);
  };
  const html = md.renderer.render(tokens, md.options, {}).replace(/<p>\s*(<figure>[\s\S]*?<\/figure>)\s*<\/p>/g, '$1');
  const text = content.replace(/!\[([^\]]*)\]\([^\n]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  const words = (text.match(/[\u4e00-\u9fff]|[A-Za-z]+/g) || []).length;
  return { ...data, html, text, headings, figureCount, readMinutes: Math.max(1, Math.ceil(words / 450)) };
}
export async function readBookDocument(slug: string) {
  const raw = await readFile(path.join(bookPath(slug), 'book.json'));
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch { throw new ContentError('书籍 JSON 资料格式不正确。'); }
  return { metadata: validateMetadata(slug, value), revision: revisionOf(raw) };
}
export async function readChapterDocument(book: string, slug: string): Promise<ChapterDocument> {
  const raw = await readFile(path.join(bookPath(book), 'chapters', `${validateSlug(slug)}.md`));
  const source = raw.toString('utf8');
  return { ...parseChapter(slug, source).data, source, revision: revisionOf(raw) };
}
async function chapterNames(slug: string) {
  return (await listDataEntries(path.join(bookPath(slug), 'chapters')))
    .filter(item => !item.isDirectory && item.name.endsWith('.md')).map(item => item.name).sort();
}
export async function listBookDocuments() {
  const directories = await listDataEntries(booksRoot());
  return Promise.all(directories.filter(item => item.isDirectory && slugPattern.test(item.name)).sort((a, b) => a.name.localeCompare(b.name)).map(async item => {
    const document = await readBookDocument(item.name);
    return { ...document, chapterCount: (await chapterNames(item.name)).length };
  }));
}
export async function readBook(slug: string, includeDrafts = false): Promise<Book | null> {
  let metadata: BookMetadata;
  try { ({ metadata } = await readBookDocument(slug)); }
  catch (error) { if (error instanceof ContentError && error.status === 404) return null; throw error; }
  if (!includeDrafts && !metadata.published) return null;
  const documents = await Promise.all((await chapterNames(slug)).map(name => readChapterDocument(slug, name.slice(0, -3))));
  const chapters = await Promise.all(documents.filter(chapter => includeDrafts || chapter.published).map(chapter => renderChapter(slug, chapter.slug, chapter.source)));
  chapters.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  let cover: string | null = null;
  if (metadata.cover) { const name = imageReference(metadata.cover, false); await readImageInfo(slug, name); cover = imageUrl(slug, name); }
  return { ...metadata, cover, chapters, chapterCount: chapters.length, figureCount: chapters.reduce((total, chapter) => total + chapter.figureCount, 0) };
}
export async function readPublishedBooks(): Promise<Book[]> {
  const documents = await listBookDocuments();
  const books = await Promise.all(documents.filter(item => item.metadata.published).map(item => readBook(item.metadata.slug)));
  return books.filter((book): book is Book => !!book && book.chapterCount > 0);
}
export async function getEditorBook(slug: string) {
  const document = await readBookDocument(slug);
  const chapters = await Promise.all((await chapterNames(slug)).map(name => readChapterDocument(slug, name.slice(0, -3))));
  const imageEntries = await listDataEntries(path.join(bookPath(slug), 'images'));
  let images = imageEntries.filter(item => !item.isDirectory && imagePattern.test(item.name)).map(item => item.name).sort();
  if (isBlobStorage()) {
    const index = await readBlobImageIndex(slug, true);
    images = images.filter(name => !!index[name]);
  }
  chapters.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return { ...document, chapters: chapters.map(({ source: _source, ...chapter }) => chapter), images };
}
function checkRevision(current: StoredFile | null, expected: string | null) {
  if ((current ? revisionOf(current.bytes) : null) !== expected) throw new ContentError('内容已被更新，或标识已存在。请重新加载后再保存。', 409);
}
async function backup(file: string, slug: string, bytes: Buffer) {
  await atomicWrite(path.join(dataRoot(), 'history', slug, `${Date.now()}-${randomUUID()}-${path.basename(file)}`), bytes, { ifAbsent: true });
}
export async function saveBook(slug: string, input: unknown, revision: string | null) {
  return serialized(`book:${slug}`, async () => {
    const metadata = validateMetadata(slug, input), file = path.join(bookPath(slug), 'book.json');
    const current = await maybeReadDataFile(file);
    checkRevision(current, revision);
    if (metadata.cover) await readImage(slug, imageReference(metadata.cover, false));
    if (current) await backup(file, slug, current.bytes);
    if (!isBlobStorage()) {
      await fs.mkdir(path.join(bookPath(slug), 'chapters'), { recursive: true });
      await fs.mkdir(path.join(bookPath(slug), 'images'), { recursive: true });
    }
    await atomicWrite(file, JSON.stringify(metadata, null, 2) + '\n', current ? { ifMatch: current.etag } : { ifAbsent: true });
    return readBookDocument(slug);
  });
}
export async function saveChapter(book: string, slug: string, source: string, revision: string | null) {
  return serialized(`book:${book}`, async () => {
    await readBookDocument(book);
    const file = path.join(bookPath(book), 'chapters', `${validateSlug(slug)}.md`);
    const current = await maybeReadDataFile(file);
    checkRevision(current, revision);
    await renderChapter(book, slug, source);
    if (current) await backup(file, book, current.bytes);
    await atomicWrite(file, source, current ? { ifMatch: current.etag } : { ifAbsent: true });
    return readChapterDocument(book, slug);
  });
}
export async function uploadImage(book: string, originalName: string, bytes: Buffer) {
  return serialized(`book:${book}`, async () => {
    await readBookDocument(book);
    const name = `${randomUUID()}${path.extname(originalName).toLowerCase()}`;
    const info = validateImage(bytes, name), file = path.join(bookPath(book), 'images', name);
    await atomicWrite(file, bytes, { ifAbsent: true });
    if (isBlobStorage()) await updateBlobImageIndex(book, name, info);
    return { name, reference: `../images/${name}`, url: imageUrl(book, name) };
  });
}
export async function registerUploadedImage(book: string, name: string) {
  validateSlug(book);
  validateImageName(name);
  if (!isBlobStorage()) throw new ContentError('当前存储方式不支持直传图片。', 400);
  await readBookDocument(book);
  const file = path.join(bookPath(book), 'images', name);
  try {
    const asset = await readImage(book, name);
    await updateBlobImageIndex(book, name, { width: asset.width, height: asset.height, type: asset.type });
  } catch (error) {
    await removeDataFile(file);
    throw error;
  }
  return { name, reference: `../images/${name}`, url: imageUrl(book, name) };
}
async function moveBlobItems(items: BlobItem[], destination: (item: BlobItem) => string) {
  for (let start = 0; start < items.length; start += 10) {
    await Promise.all(items.slice(start, start + 10).map(item => copy(item.url, destination(item), {
      access: 'private', addRandomSuffix: false,
    })));
  }
  for (let start = 0; start < items.length; start += 10) {
    await Promise.all(items.slice(start, start + 10).map(item => del(item.url, { ifMatch: item.etag })));
  }
}
export async function trashContent(book: string, chapter: string | null, revision: string) {
  return serialized(`book:${book}`, async () => {
    const root = bookPath(book), file = chapter ? path.join(root, 'chapters', `${validateSlug(chapter)}.md`) : path.join(root, 'book.json');
    const trash = path.join(dataRoot(), 'trash', `${Date.now()}-${randomUUID()}`, book);
    if (isBlobStorage()) {
      const current = await maybeReadDataFile(file);
      checkRevision(current, revision);
      if (chapter) {
        const item = await head(blobPath(file));
        await copy(item.url, blobPath(path.join(trash, `${chapter}.md`)), { access: 'private', addRandomSuffix: false });
        await del(item.url, { ifMatch: item.etag });
      } else {
        const prefix = `${blobPath(root).replace(/\/$/, '')}/`, items = await listBlobItems(prefix);
        await moveBlobItems(items, item => blobPath(path.join(trash, 'book', item.pathname.slice(prefix.length))));
        blobImageIndexCache.delete(book);
      }
      return;
    }
    checkRevision(await maybeReadDataFile(file), revision);
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(chapter ? file : root, chapter ? path.join(trash, `${chapter}.md`) : path.join(trash, 'book'));
  });
}
