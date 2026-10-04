import './env';
import fs from 'node:fs/promises';
import path from 'node:path';
import { list, put } from '@vercel/blob';
import { validateImage, validateImageName, validateSlug } from '../src/lib/content-store';

const overwrite = process.argv.includes('--overwrite');
const fromIndex = process.argv.indexOf('--from');
const sourceArgument = fromIndex >= 0 ? process.argv[fromIndex + 1] : undefined;
if (fromIndex >= 0 && (!sourceArgument || sourceArgument.startsWith('--'))) {
  throw new Error('`--from` 后请指定包含书籍目录的路径。');
}
const sourceRoot = path.resolve(sourceArgument || path.join(process.env.DATA_DIR || 'data', 'books'));
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error('本地迁移需要 BLOB_READ_WRITE_TOKEN。请先运行 `vercel env pull .env.local`，并确认 Blob store 已连接到 Development 环境。');
}

async function walk(directory: string, relative = ''): Promise<Array<{ absolute: string; relative: string }>> {
  const output: Array<{ absolute: string; relative: string }> = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;
    const child = path.join(directory, entry.name), childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child, childRelative));
    else if (entry.isFile()) output.push({ absolute: child, relative: childRelative.split(path.sep).join('/') });
  }
  return output;
}

async function existingBookObjects(): Promise<Set<string>> {
  const names = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'books/', cursor, limit: 1000 });
    for (const blob of page.blobs) names.add(blob.pathname);
    cursor = page.cursor;
  } while (cursor);
  return names;
}

const directories = await fs.readdir(sourceRoot, { withFileTypes: true });
const books = directories.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
if (!books.length) throw new Error(`没有在 ${sourceRoot} 找到书籍目录。`);
const existing = await existingBookObjects();
let uploaded = 0, skipped = 0, indexedImages = 0;

for (const book of books) {
  validateSlug(book.name);
  const root = path.join(sourceRoot, book.name), files = await walk(root);
  const imageIndex: Record<string, ReturnType<typeof validateImage>> = {};
  for (const file of files) {
    if (file.relative === 'image-index.json') continue;
    const bytes = await fs.readFile(file.absolute), key = `books/${book.name}/${file.relative}`;
    if (file.relative.startsWith('images/') && !file.relative.slice('images/'.length).includes('/')) {
      const name = file.relative.slice('images/'.length);
      if (/\.(webp|png|jpe?g|gif)$/i.test(name)) {
        validateImageName(name);
        imageIndex[name] = validateImage(bytes, name);
        indexedImages++;
      }
    }
    if (existing.has(key) && !overwrite) { skipped++; continue; }
    await put(key, bytes, { access: 'private', addRandomSuffix: false, allowOverwrite: overwrite });
    existing.add(key);
    uploaded++;
  }

  const indexKey = `books/${book.name}/image-index.json`;
  if (!existing.has(indexKey) || overwrite) {
    await put(indexKey, JSON.stringify(imageIndex) + '\n', {
      access: 'private', addRandomSuffix: false, allowOverwrite: overwrite,
    });
    existing.add(indexKey);
    uploaded++;
  } else {
    skipped++;
  }
}

console.log(`迁移完成：上传 ${uploaded} 个对象，跳过 ${skipped} 个已存在对象；检查 ${indexedImages} 张图片。`);
console.log('本脚本只迁移 data/books，不会上传会话、历史版本、回收目录或管理员凭据。');
