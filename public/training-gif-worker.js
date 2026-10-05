import { GIFEncoder, quantize, applyPalette } from './training-vision/gifenc.js';

let encoder, width, height, count = 0;
self.onmessage = event => {
  try {
    const data = event.data;
    if (data.type === 'init') {
      if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || Math.max(data.width, data.height) > 360) throw new Error('尺寸无效');
      width = data.width; height = data.height; count = 0; encoder = GIFEncoder();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      if (!encoder || count >= 48 || !(data.pixels instanceof ArrayBuffer) || data.pixels.byteLength !== width * height * 4) throw new Error('帧无效');
      const rgba = new Uint8Array(data.pixels), palette = quantize(rgba, 128), indices = applyPalette(rgba, palette);
      encoder.writeFrame(indices, width, height, { palette, delay: 125, repeat: 0 });
      count++;
      if (encoder.bytesView().length > 4 * 1024 * 1024) throw new Error('GIF 超过 4 MB，请选择更短的片段。');
      self.postMessage({ type: 'frame' });
    } else if (data.type === 'finish') {
      if (!encoder || count < 2) throw new Error('帧不足');
      encoder.finish();
      const bytes = encoder.bytes();
      self.postMessage({ type: 'done', bytes: bytes.buffer }, [bytes.buffer]);
      encoder = null;
    } else throw new Error('请求无效');
  } catch (error) { self.postMessage({ type: 'error', error: error.message || 'GIF 编码失败。' }); }
};
