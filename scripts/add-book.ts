import './env';
import { saveBook, saveChapter, validateSlug } from '../src/lib/content-store';
async function main() {
  const [slug, title] = process.argv.slice(2);
  if (!slug || !title) throw new Error('用法：npm run add-book -- tennis-notes "网球训练笔记"');
  await saveBook(validateSlug(slug), { title, published: false }, null);
  await saveChapter(slug, '01-introduction', '---\ntitle: 引言\norder: 1\ngroup: 正文\npublished: false\n---\n\n在这里写正文。\n', null);
  console.log(`已创建草稿 ${slug}。可在 /admin/books/${slug}/ 编辑和发布。`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
