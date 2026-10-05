import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentError } from '../src/lib/content-store';
import { analyzeTeachingLesson, validateLessonAnalysisRequest, validateLessonAnalysisResult } from '../src/lib/training-lesson-ai';
import { MAX_ANALYSIS_BYTES, MAX_FRAME_BYTES } from '../src/lib/training-ai-types';

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;
const sourceText = '先做分腿垫步，再向来球方向移动。保持身体平衡。';
const request = () => ({ consent: true as const, title: '步法教学', category: 'footwork', sourceText, durationSeconds: 10, frames: [{ atSeconds: 1.25, image: jpeg }, { atSeconds: 2.5, image: jpeg }] });
const output = () => ({
  summary: '来源包含分腿垫步和移动说明。',
  steps: [{ title: '分腿垫步', cue: '先垫步', instructions: '根据所给来源查看并练习。', repetitions: '请自行设定练习次数', sourceQuote: '先做分腿垫步', frameIndex: 1 }],
  limitations: ['所选静帧不足以推断完整动作节奏。'], insufficientEvidence: false,
});
const completed = (value: unknown) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const status = (expected: number) => (error: unknown) => error instanceof ContentError && error.status === expected;

test('teaching analysis requires consent and supplied text or selected JPEG frames', () => {
  const textOnly = validateLessonAnalysisRequest({ ...request(), frames: [], durationSeconds: null });
  assert.equal(textOnly.sourceText, sourceText);
  assert.equal(textOnly.frames.length, 0);
  const framesOnly = validateLessonAnalysisRequest({ ...request(), sourceText: '' });
  assert.equal(framesOnly.frames.length, 2);
  assert.throws(() => validateLessonAnalysisRequest({ ...request(), consent: false }));
  assert.throws(() => validateLessonAnalysisRequest({ ...request(), sourceText: '', frames: [], sourceUrl: 'https://example.com/lesson' }));
  assert.throws(() => validateLessonAnalysisRequest({ ...request(), sourceText: 'x'.repeat(30_001) }));
  assert.throws(() => validateLessonAnalysisRequest({ ...request(), frames: Array.from({ length: 7 }, () => request().frames[0]) }));
  for (const atSeconds of [-1, Number.NaN, Infinity, 10.1]) {
    assert.throws(() => validateLessonAnalysisRequest({ ...request(), frames: [{ atSeconds, image: jpeg }] }));
  }
  for (const image of ['https://private.example/frame.jpg', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,YWJjZA==']) {
    assert.throws(() => validateLessonAnalysisRequest({ ...request(), frames: [{ atSeconds: 0, image }] }));
  }
});

test('teaching payload and frame caps reject oversized data before any provider call', async () => {
  const image = Buffer.alloc(MAX_FRAME_BYTES + 1); image[0] = 0xff; image[1] = 0xd8; image[image.length - 2] = 0xff; image[image.length - 1] = 0xd9;
  assert.throws(() => validateLessonAnalysisRequest({ ...request(), frames: [{ atSeconds: 0, image: `data:image/jpeg;base64,${image.toString('base64')}` }] }), status(413));
  const oversized = { ...request(), sourceText: 'x'.repeat(MAX_ANALYSIS_BYTES) };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return completed(output()); };
  await assert.rejects(analyzeTeachingLesson(oversized, { apiKey: 'test-only-secret', fetchImpl }), status(413));
  await assert.rejects(analyzeTeachingLesson({ ...request(), consent: false }, { apiKey: 'test-only-secret', fetchImpl }));
  assert.equal(calls, 0);
});

test('AI steps keep exact submitted frame timestamps and remain unconfirmed drafts', () => {
  const valid = validateLessonAnalysisResult(output(), validateLessonAnalysisRequest(request()));
  assert.equal(valid.steps[0].evidenceAtSeconds, 2.5);
  assert.equal(valid.steps[0].sourceQuote, '先做分腿垫步');
  assert.equal(valid.steps[0].origin, 'ai');
  assert.equal(valid.steps[0].confirmed, false);
  assert.equal(valid.steps[0].startSeconds, null);
  assert.equal(valid.steps[0].endSeconds, null);
  assert.equal(valid.steps[0].gifMediaId, null);
  assert.match(valid.steps[0].id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(valid.steps[0].id, validateLessonAnalysisResult(output(), validateLessonAnalysisRequest(request())).steps[0].id);
});

test('every AI teaching step is grounded in submitted text or a selected frame', () => {
  const req = validateLessonAnalysisRequest(request());
  for (const frameIndex of [-1, 2, 0.5]) {
    assert.throws(() => validateLessonAnalysisResult({ ...output(), steps: [{ ...output().steps[0], frameIndex }] }, req), status(502));
  }
  for (const sourceQuote of ['原文没有说的内容', '先做分腿垫步，再保持身体平衡。']) {
    assert.throws(() => validateLessonAnalysisResult({ ...output(), steps: [{ ...output().steps[0], sourceQuote }] }, req), status(502));
  }
  assert.throws(() => validateLessonAnalysisResult({ ...output(), steps: [{ ...output().steps[0], sourceQuote: '', frameIndex: null }] }, req), status(502));
  const textOnly = validateLessonAnalysisRequest({ ...request(), frames: [] });
  const textResult = validateLessonAnalysisResult({ ...output(), steps: [{ ...output().steps[0], frameIndex: null }] }, textOnly);
  assert.equal(textResult.steps[0].evidenceAtSeconds, null);
  assert.throws(() => validateLessonAnalysisResult(output(), textOnly), status(502));
  const frameOnly = validateLessonAnalysisRequest({ ...request(), sourceText: '' });
  const frameResult = validateLessonAnalysisResult({ ...output(), steps: [{ ...output().steps[0], sourceQuote: '' }] }, frameOnly);
  assert.equal(frameResult.steps[0].evidenceAtSeconds, 2.5);
  assert.throws(() => validateLessonAnalysisResult(output(), frameOnly), status(502));
  assert.throws(() => validateLessonAnalysisResult({ ...output(), steps: Array.from({ length: 7 }, () => output().steps[0]) }, req), status(502));
  assert.throws(() => validateLessonAnalysisResult({ ...output(), insufficientEvidence: 'false' }, req), status(502));
});

test('Responses sends only supplied teaching text and selected frames with store false', async () => {
  let sent: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    sent = JSON.parse(String(init?.body));
    return completed(output());
  };
  const input = { ...request(), sourceUrl: 'https://private-source.example/not-submitted', mediaId: 'private-video-marker' };
  const result = await analyzeTeachingLesson(input, { apiKey: 'test-only-secret', model: 'test-model', fetchImpl });
  assert.equal(sent!.store, false);
  assert.equal(sent!.model, 'test-model');
  assert.doesNotMatch(JSON.stringify(sent), /private-source|private-video-marker|test-only-secret/);
  const contents = (sent!.input as Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>)[0].content;
  assert.equal(contents.filter(part => part.type === 'input_image').length, 2);
  assert.ok(contents.filter(part => part.type === 'input_image').every(part => part.image_url === jpeg));
  assert.ok(contents.some(part => part.type === 'input_text' && part.text?.includes(sourceText)));
  const format = (sent!.text as { format: { type: string; strict: boolean } }).format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.strict, true);
  assert.equal(result.steps[0].confirmed, false);
});

test('refusal, incomplete results and unsupported source claims return recoverable errors', async () => {
  const responses = [
    Response.json({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'provider-private-refusal-content' }] }] }),
    Response.json({ status: 'incomplete', output: [] }),
    completed({ ...output(), steps: [{ ...output().steps[0], sourceQuote: 'Not supplied by the user' }] }),
    completed({ ...output(), steps: [{ ...output().steps[0], frameIndex: 99 }] }),
  ];
  for (const response of responses) {
    const fetchImpl: typeof fetch = async () => response;
    await assert.rejects(analyzeTeachingLesson(request(), { apiKey: 'test-only-secret', fetchImpl }), (error: unknown) => {
      assert.ok(error instanceof ContentError);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /provider-private|test-only-secret/);
      return true;
    });
  }
});

test('provider failures and timeouts expose no upstream body or credentials', async () => {
  for (const providerStatus of [429, 500]) {
    const fetchImpl: typeof fetch = async () => new Response('provider-private-body test-only-secret', { status: providerStatus });
    await assert.rejects(analyzeTeachingLesson(request(), { apiKey: 'test-only-secret', fetchImpl }), (error: unknown) => {
      assert.ok(error instanceof ContentError);
      assert.equal(error.status, providerStatus === 429 ? 429 : 502);
      assert.doesNotMatch(error.message, /provider-private-body|test-only-secret/);
      return true;
    });
  }
  const offline: typeof fetch = async () => { throw new Error('network details test-only-secret'); };
  await assert.rejects(analyzeTeachingLesson(request(), { apiKey: 'test-only-secret', fetchImpl: offline }), (error: unknown) => {
    assert.ok(error instanceof ContentError); assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /network details|test-only-secret/); return true;
  });
  const waiting: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('mock abort')), { once: true });
  });
  await assert.rejects(analyzeTeachingLesson(request(), { apiKey: 'test-only-secret', fetchImpl: waiting, timeoutMs: 5 }), status(504));
  let called = false;
  const unexpected: typeof fetch = async () => { called = true; return completed(output()); };
  await assert.rejects(analyzeTeachingLesson(request(), { apiKey: '', fetchImpl: unexpected }), status(503));
  assert.equal(called, false);
});
