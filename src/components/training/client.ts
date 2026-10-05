import { publicPath } from '@/lib/urls';

export type LocalDraft = { dirty: boolean; value: unknown };

export class TrainingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function trainingRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(publicPath(path), {
    ...options,
    cache: 'no-store',
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  let data;
  try { data = await response.json(); }
  catch { throw new TrainingRequestError('服务器没有返回可读取的结果，请稍后重试。', response.status); }
  if (!response.ok) throw new TrainingRequestError(data.error || '操作失败，请稍后重试。', response.status);
  return data as T;
}

export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const numberOrNull = (value: string): number | null => value.trim() === '' ? null : Number(value);
export const trainingDateLabel = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', ...(value.length > 10 ? { timeStyle: 'short' as const } : {}) }).format(new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value));
export const timestamp = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
export const kindLabel = { coach: '私教', machine: '发球机', partner: '球友', gym: '健身房' } as const;
export const strokeLabel = { forehand: '正手', backhand: '反手', serve: '发球', volley: '截击', footwork: '步法' } as const;
export const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
