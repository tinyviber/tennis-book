import 'server-only';
import { cache } from 'react';
import { readBook, readPublishedBooks, validateSlug } from './content-store';
import type { Book, BookSummary } from './types';

export const getBooks = cache(readPublishedBooks);
export const getBook = cache((slug:string) => {
  try { validateSlug(slug); } catch { return Promise.resolve(null); }
  return readBook(slug);
});
export function summarizeBook(book:Book):BookSummary {
  return { ...book, chapters: book.chapters.map(({ slug, title, group, order, pageStart, pageEnd, readMinutes }) => ({ slug, title, group, order, pageStart, pageEnd, readMinutes })) };
}
