import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from '@vercel/blob';
import { ContentError, dataRoot, revisionOf } from './content-store';

/** Private mutable data only, including personal teaching cards. Books come from Git. */
export { ContentError, dataRoot, revisionOf, MAX_DOCUMENT_BYTES } from './content-store';
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
  if (relative === null || !/^(auth|training)(\/|$)/.test(relative)) throw new ContentError('私人运行数据路径越界。');
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
  blobPath(directory);
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
  blobPath(file);
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
export async function atomicWrite(file: string, value: string | Buffer, condition?: WriteCondition): Promise<void> {
  blobPath(file);
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
  blobPath(file);
  if (isBlobStorage()) {
    try {
      const metadata = await head(blobPath(file));
      await del(metadata.url, etag ? { ifMatch: etag } : undefined);
    } catch (error) { if (!isMissing(error)) throw error; }
    return;
  }
  await fs.rm(file, { force: true });
}
// Serialize local writes; Blob writes also use ETags to coordinate across function instances.
const edits = new Map<string, Promise<unknown>>();
export async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = edits.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  edits.set(key, next);
  try { return await next; } finally { if (edits.get(key) === next) edits.delete(key); }
}
