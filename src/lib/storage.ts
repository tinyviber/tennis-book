import type { Progress } from './types';
export const progressKey = (book:string) => `shujian:v1:progress:${book}`;
export function readProgress(book:string):Progress|null {
  try {
    const value=JSON.parse(localStorage.getItem(progressKey(book)) || 'null');
    return value && typeof value.chapter==='string' && typeof value.ratio==='number' ? value : null;
  } catch { return null; }
}
