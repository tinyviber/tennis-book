import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';

if (process.env.VERCEL !== '1') process.exit(0);

const dataRoot = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const booksRoot = path.join(dataRoot, 'books');
const publicBooksRoot = path.join(process.cwd(), 'public', 'books');
const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(webp|png|jpe?g|gif)$/i;
const imageTypes = new Set(['webp', 'png', 'jpg', 'gif']);

await fs.rm(publicBooksRoot, { recursive: true, force: true });

let copiedBooks = 0;
let copiedImages = 0;
for (const entry of await fs.readdir(booksRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;

  const bookRoot = path.join(booksRoot, entry.name);
  const metadata = JSON.parse(await fs.readFile(path.join(bookRoot, 'book.json'), 'utf8'));
  if (metadata.published === false) continue;

  const sourceImages = path.join(bookRoot, 'images');
  const targetImages = path.join(publicBooksRoot, entry.name, 'images');
  const index = {};
  for (const image of await fs.readdir(sourceImages, { withFileTypes: true })) {
    if (!image.isFile() || !imagePattern.test(image.name)) continue;

    const source = path.join(sourceImages, image.name);
    const bytes = await fs.readFile(source);
    const dimensions = imageSize(bytes);
    const type = dimensions.type === 'jpeg' ? 'jpg' : dimensions.type;
    const extension = path.extname(image.name).slice(1).toLowerCase().replace('jpeg', 'jpg');
    if (!dimensions.width || !dimensions.height || !imageTypes.has(type) || type !== extension) {
      throw new Error(`无效的书籍图片：${path.relative(process.cwd(), source)}`);
    }

    index[image.name] = { width: dimensions.width, height: dimensions.height, type };
    await fs.mkdir(targetImages, { recursive: true });
    await fs.copyFile(source, path.join(targetImages, image.name));
    copiedImages++;
  }

  await fs.writeFile(path.join(bookRoot, 'image-index.json'), `${JSON.stringify(index)}\n`);
  copiedBooks++;
}

console.log(`已准备 ${copiedBooks} 本已发布书籍和 ${copiedImages} 张静态图片。`);
