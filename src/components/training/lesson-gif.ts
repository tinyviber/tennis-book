import { publicPath } from '@/lib/urls';

/** Capture/encode one bounded frame at a time. No video or image is sent to an external service. */
export async function createTeachingGif(source: HTMLVideoElement, start: number, end: number, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<Blob> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 6 || !Number.isFinite(source.duration) || end > source.duration) throw new Error('GIF 区间须在原片以内，且不超过 6 秒。');
  if (!window.Worker) throw new Error('此浏览器不支持后台 GIF 编码，仍可使用原片循环播放。');
  const controller = new AbortController(), video = document.createElement('video');
  const worker = new Worker(publicPath('/training-gif-worker.js'), { type: 'module' });
  video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'; video.preload = 'auto';
  const sourceUrl = source.currentSrc || source.src;
  if (!sourceUrl) { worker.terminate(); throw new Error('请先加载教学原片。'); }
  let rejectPending: ((error: Error) => void) | null = null;
  let workerFailure: Error | null = null;
  worker.onerror = () => { workerFailure = new Error('GIF 编码器启动失败，仍可使用原片循环播放。'); rejectPending?.(workerFailure); };
  const cancel = () => { controller.abort(); rejectPending?.(new Error('GIF 生成已取消。')); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 60_000);
  function check() { if (controller.signal.aborted) throw new Error('GIF 生成已取消或超时。'); }
  function videoEvent(name: 'loadeddata' | 'seeked', action?: () => void): Promise<void> {
    check();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); video.removeEventListener(name, ready); video.removeEventListener('error', fail); controller.signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      };
      const ready = () => finish(), fail = () => finish(new Error('浏览器无法读取原片；请重新加载或上传 MP4 短片。')), aborted = () => finish(new Error('GIF 生成已取消。'));
      const timer = setTimeout(() => finish(new Error('读取教学视频超时，请重新加载。')), 8000);
      video.addEventListener(name, ready, { once: true }); video.addEventListener('error', fail, { once: true }); controller.signal.addEventListener('abort', aborted, { once: true });
      try { action?.(); } catch (error) { finish(error as Error); }
    });
  }
  function send(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<MessageEvent['data']> {
    check();
    if (workerFailure) throw workerFailure;
    return new Promise((resolve, reject) => {
      const cleanup = () => { worker.onmessage = null; rejectPending = null; };
      rejectPending = error => { cleanup(); reject(error); };
      worker.onmessage = event => { cleanup(); if (event.data.type === 'error') reject(new Error(event.data.error)); else resolve(event.data); };
      worker.postMessage(message, transfer);
    });
  }
  try {
    check();
    await videoEvent('loadeddata', () => { video.src = sourceUrl; video.load(); });
    const scale = Math.min(1, 360 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale)), height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('此浏览器无法截取画面，仍可使用原片循环播放。');
    await send({ type: 'init', width, height });
    const frameCount = Math.max(2, Math.min(48, Math.ceil((end - start) * 8)));
    for (let index = 0; index < frameCount; index++) {
      check();
      const at = start + (end - start) * index / frameCount;
      if (Math.abs(video.currentTime - at) > .0001) await videoEvent('seeked', () => { video.currentTime = at; });
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      await send({ type: 'frame', pixels: pixels.buffer }, [pixels.buffer]);
      options.onProgress?.((index + 1) / (frameCount + 1));
    }
    const result = await send({ type: 'finish' });
    const blob = new Blob([result.bytes], { type: 'image/gif' });
    if (blob.size > 4 * 1024 * 1024) throw new Error('GIF 超过 4 MB，请选择更短的片段。');
    options.onProgress?.(1);
    return blob;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') throw new Error('原片地址不允许截取画面，请重新上传本地短片；循环播放仍可使用。');
    throw error;
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); worker.terminate(); video.pause(); video.removeAttribute('src'); video.load();
  }
}
