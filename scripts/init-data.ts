import './env';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { booksRoot, dataRoot, isMissing, readBook, validateSlug } from '../src/lib/content-store';
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--from')) throw new Error('用法：npm run init-data -- --from /path/to/books');
  const destination = dataRoot();
  await fs.mkdir(booksRoot(), { recursive: true });
  const source = path.resolve(args[1] || 'content/books');
  if (source === booksRoot()) { console.log('数据目录已就绪。'); return; }
  let directories;
  try { directories = await fs.readdir(source, { withFileTypes: true }); }
  catch (error) {
    if (!args.length && isMissing(error)) { console.log(`数据目录已就绪：${destination}。可在后台添加书籍，或用 --from 导入现有 books 目录。`); return; }
    throw error;
  }
  for (const directory of directories.filter(item => item.isDirectory())) {
    const slug = validateSlug(directory.name), target = path.join(destination, 'books', slug);
    try { await fs.access(target); console.log(`跳过已有书籍：${slug}（不覆盖）。`); continue; }
    catch (error) { if (!isMissing(error)) throw error; }
    const staging = path.join(destination, `.import-${randomUUID()}`), originalDataDir = process.env.DATA_DIR;
    try {
      await fs.cp(path.join(source, slug), path.join(staging, 'books', slug), { recursive: true, dereference: false });
      process.env.DATA_DIR = staging;
      const book = await readBook(slug, true);
      if (!book) throw new Error(`无法导入：${slug}`);
      if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
      await fs.rename(path.join(staging, 'books', slug), target);
      console.log(`已导入 ${book.title}：${book.chapterCount} 节，${book.figureCount} 幅图组。`);
    } finally {
      if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
