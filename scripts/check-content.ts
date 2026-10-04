import './env';
import { listBookDocuments, readBook } from '../src/lib/content-store';
async function main() {
  const documents = await listBookDocuments();
  let chapters = 0, figures = 0;
  for (const { metadata } of documents) {
    const book = await readBook(metadata.slug, true);
    if (book) { chapters += book.chapterCount; figures += book.figureCount; }
  }
  console.log(`已验证 ${documents.length} 本书、${chapters} 节、${figures} 幅图组（包含草稿）。`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
