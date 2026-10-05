/* MediaPipe 0.10.32 is pinned in package-lock; only model weights are fetched remotely. */
let landmarker;
self.onmessage = async event => {
  const { bitmap, assetBase, modelUrl } = event.data;
  try {
    if (!landmarker) {
      self.exports = {};
      importScripts(`${assetBase}/vision_bundle.js`);
      const vision = self.exports;
      const files = await vision.FilesetResolver.forVisionTasks(`${assetBase}/wasm`);
      landmarker = await vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: modelUrl || 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: false, canvas: new OffscreenCanvas(1, 1),
      });
    }
    const result = landmarker.detect(bitmap);
    self.postMessage({ points: result.landmarks[0] ?? [] });
    result.close();
  } catch {
    self.postMessage({ error: '本地姿态模型未能完成。请检查网络或浏览器支持，继续手动复盘。' });
  } finally { bitmap?.close(); }
};
