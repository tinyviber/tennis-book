import path from 'node:path';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { get, head, issueSignedToken, presignUrl } from '@vercel/blob';
import { atomicWrite, ContentError, dataRoot, isBlobStorage, isMissing, readDataFile, serialized } from './runtime-store';
import { trainingObject, validateMediaId } from './training-validation';
import type { MediaAsset, MediaReservation } from './training-types';
import { publicPath } from './urls';

export { validateMediaId } from './training-validation';
export const MAX_TRAINING_MEDIA_BYTES = 100 * 1024 * 1024;
const mimeExtensions: Record<MediaAsset['contentType'], string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
type StoredAsset = Omit<MediaAsset, 'url'> & { pathname: string };
const indexPath = () => path.join(dataRoot(), 'training', 'media', 'index.json');
const blobPath = (id: string, contentType: MediaAsset['contentType']) => `training/media/${validateMediaId(id)}.${mimeExtensions[contentType]}`;
const localPath = (asset: StoredAsset) => path.join(dataRoot(), asset.pathname);
const expose = ({ pathname: _pathname, ...asset }: StoredAsset): MediaAsset => ({ ...asset, url: publicPath(`/api/training/media/${asset.id}/`) });

export function validateMediaUpload(input: unknown): { name: string; contentType: MediaAsset['contentType']; size: number } {
  const value = trainingObject(input);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(value.name)) throw new ContentError('素材名称无效。');
  if (typeof value.contentType !== 'string' || !Object.hasOwn(mimeExtensions, value.contentType)) throw new ContentError('素材支持 MP4、MOV、WebM、JPEG、PNG、WebP 和 GIF。', 415);
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_TRAINING_MEDIA_BYTES) throw new ContentError('素材须在 100 MB 以内，建议上传短片。', 413);
  if (value.contentType === 'image/gif' && value.size > 4 * 1024 * 1024) throw new ContentError('教学 GIF 须在 4 MB 以内。', 413);
  return { name: value.name.trim(), contentType: value.contentType as MediaAsset['contentType'], size: value.size };
}
export function validateMediaSignature(bytes: Buffer, contentType: MediaAsset['contentType']): void {
  let valid = false;
  if (contentType === 'image/gif') valid = bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes.readUInt16LE(6) <= 4000 && bytes.readUInt16LE(8) <= 4000;
  if (contentType === 'image/png') valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/jpeg') valid = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (contentType === 'image/webp') valid = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'video/webm') valid = bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (contentType === 'video/mp4' || contentType === 'video/quicktime') valid = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  if (!valid) throw new ContentError('素材文件头与声明格式不符，请选择有效的图片或短片。', 415);
}
async function readIndex(): Promise<{ assets: StoredAsset[]; etag?: string }> {
  let current;
  try { current = await readDataFile(indexPath()); } catch (error) { if (isMissing(error)) return { assets: [] }; throw error; }
  let value: unknown;
  try { value = JSON.parse(current.bytes.toString('utf8')); } catch { throw new ContentError('私人素材索引损坏。', 500); }
  if (!Array.isArray(value)) throw new ContentError('私人素材索引损坏。', 500);
  const assets: StoredAsset[] = value.map(item => {
    const input = trainingObject(item), id = validateMediaId(input.id), metadata = validateMediaUpload(input);
    if (!['pending', 'ready'].includes(String(input.status)) || typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt)) || input.pathname !== blobPath(id, metadata.contentType)) throw new ContentError('私人素材索引损坏。', 500);
    return { ...metadata, id, status: input.status as StoredAsset['status'], createdAt: input.createdAt, pathname: input.pathname };
  });
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) throw new ContentError('私人素材索引标识重复。', 500);
  return { assets, etag: current.etag };
}
async function updateIndex(operation: (assets: StoredAsset[]) => StoredAsset[]): Promise<void> {
  return serialized('training:media-index', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await readIndex();
      const assets = operation(current.assets);
      try { await atomicWrite(indexPath(), JSON.stringify(assets, null, 2) + '\n', current.etag ? { ifMatch: current.etag } : { ifAbsent: true }); return; }
      catch (error) { if (!(error instanceof ContentError && error.status === 409)) throw error; }
    }
    throw new ContentError('私人素材索引正在更新，请稍后重试。', 409);
  });
}
async function findAsset(id: string): Promise<StoredAsset> {
  const asset = (await readIndex()).assets.find(asset => asset.id === validateMediaId(id));
  if (!asset) throw new ContentError('私人素材不存在。', 404);
  return asset;
}
export async function listTrainingMedia(): Promise<MediaAsset[]> {
  return (await readIndex()).assets.map(expose).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function reserveTrainingMedia(input: unknown): Promise<MediaReservation> {
  if (!isBlobStorage()) throw new ContentError('本地存储请直接上传文件。');
  const metadata = validateMediaUpload(input), id = randomUUID();
  const asset: StoredAsset = { ...metadata, id, status: 'pending', createdAt: new Date().toISOString(), pathname: blobPath(id, metadata.contentType) };
  await updateIndex(assets => [...assets, asset]);
  return { asset: expose(asset), pathname: asset.pathname, uploadUrl: '/api/training/media/upload/' };
}
export async function uploadTrainingMedia(name: string, contentType: string, bytes: Buffer): Promise<MediaAsset> {
  if (isBlobStorage()) throw new ContentError('Blob 存储请使用受保护的浏览器直传。');
  const metadata = validateMediaUpload({ name, contentType, size: bytes.length });
  validateMediaSignature(bytes, metadata.contentType);
  const id = randomUUID(), asset: StoredAsset = { ...metadata, id, status: 'ready', createdAt: new Date().toISOString(), pathname: blobPath(id, metadata.contentType) };
  await atomicWrite(localPath(asset), bytes, { ifAbsent: true });
  await updateIndex(assets => [...assets, asset]);
  return expose(asset);
}
/** SDK token generation may only address an existing reservation's exact immutable path. */
export async function trainingUploadReservation(pathname: string): Promise<StoredAsset> {
  const match = /^training\/media\/([0-9a-f-]{36})\.(mp4|mov|webm|jpg|png|webp|gif)$/.exec(pathname);
  if (!match) throw new ContentError('私人素材上传路径无效。');
  const asset = await findAsset(match[1]);
  if (asset.pathname !== pathname || asset.status !== 'pending') throw new ContentError('上传预约无效或已完成。', 409);
  return asset;
}
async function firstBlobBytes(pathname: string): Promise<Buffer> {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) throw new ContentError('私人素材尚未上传完成。', 404);
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < 32) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value.subarray(0, 512)); size += chunks[chunks.length - 1].byteLength;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
/** Called both by the signed SDK callback and by the authenticated client; duplicate callbacks are safe. */
export async function registerTrainingMedia(id: string, completedPathname?: string): Promise<MediaAsset> {
  if (!isBlobStorage()) throw new ContentError('本地上传无需完成回调。');
  const asset = await findAsset(id);
  if (completedPathname !== undefined && completedPathname !== asset.pathname) throw new ContentError('私人素材完成路径无效。');
  if (asset.status === 'ready') return expose(asset);
  const metadata = await head(asset.pathname);
  if (metadata.pathname !== asset.pathname || metadata.size !== asset.size || metadata.contentType?.split(';')[0] !== asset.contentType) throw new ContentError('上传素材与预约的大小或格式不符。');
  validateMediaSignature(await firstBlobBytes(asset.pathname), asset.contentType);
  await updateIndex(assets => assets.map(item => item.id === asset.id ? { ...item, status: 'ready' } : item));
  return expose({ ...asset, status: 'ready' });
}
export async function trainingMediaExists(id: string): Promise<boolean> {
  try {
    const asset = await findAsset(id);
    if (asset.status !== 'ready') return false;
    if (isBlobStorage()) return (await head(asset.pathname)).size === asset.size;
    const [file, root] = await Promise.all([fs.realpath(localPath(asset)), fs.realpath(dataRoot())]);
    if (!file.startsWith(root + path.sep)) throw new ContentError('私人素材路径越界。');
    return (await fs.stat(file)).size === asset.size;
  } catch (error) { if (isMissing(error)) return false; throw error; }
}
export async function readTrainingMedia(id: string): Promise<{ asset: MediaAsset; bytes: Buffer }> {
  const asset = await findAsset(id);
  if (asset.status !== 'ready') throw new ContentError('私人素材尚未上传完成。', 404);
  const { bytes } = await readDataFile(localPath(asset));
  return { asset: expose(asset), bytes };
}
/** The caller owns the handle and must close it, or pass ownership to an auto-closing stream. */
export async function openLocalTrainingMedia(id: string): Promise<{ asset: MediaAsset; handle: FileHandle; size: number }> {
  if (isBlobStorage()) throw new ContentError('本地素材读取不适用于 Blob 存储。');
  const asset = await findAsset(id);
  if (asset.status !== 'ready') throw new ContentError('私人素材尚未上传完成。', 404);
  let handle: FileHandle | undefined;
  try {
    const [resolved, root] = await Promise.all([fs.realpath(localPath(asset)), fs.realpath(dataRoot())]);
    if (!resolved.startsWith(root + path.sep)) throw new ContentError('私人素材路径越界。');
    // Open the validated real path; reject a final symlink introduced between validation and opening.
    handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [stat, checkedPath] = await Promise.all([handle.stat(), fs.realpath(localPath(asset))]);
    if (checkedPath !== resolved || !stat.isFile() || stat.size !== asset.size || stat.size > MAX_TRAINING_MEDIA_BYTES) throw new ContentError('私人素材与记录不符。', 500);
    return { asset: expose(asset), handle, size: stat.size };
  } catch (error) {
    await handle?.close();
    if (isMissing(error)) throw new ContentError('私人素材不存在。', 404);
    throw error;
  }
}
export async function signedTrainingMediaUrl(id: string): Promise<{ asset: MediaAsset; url: string }> {
  const asset = await findAsset(id);
  if (!isBlobStorage() || asset.status !== 'ready') throw new ContentError('私人素材不存在。', 404);
  try { await head(asset.pathname); } catch (error) { if (isMissing(error)) throw new ContentError('私人素材不存在。', 404); throw error; }
  const validUntil = Date.now() + 60_000;
  const token = await issueSignedToken({ pathname: asset.pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname: asset.pathname, access: 'private', validUntil });
  return { asset: expose(asset), url: presignedUrl };
}
export function parseByteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new ContentError('录像读取区间无效。', 416);
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new ContentError('录像读取区间无效。', 416); start = Math.max(size - suffix, 0); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new ContentError('录像读取区间无效。', 416);
  return { start, end };
}
