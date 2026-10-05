import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentError } from '../src/lib/content-store';
import { analyzeTrainingFrames, validateAnalysisRequest, validateAnalysisResult } from '../src/lib/training-ai';
import { MAX_ANALYSIS_BYTES, MAX_FRAME_BYTES } from '../src/lib/training-ai-types';

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;
const request = () => ({ consent: true as const, stroke: 'forehand', coachNotes: 'Keep one cue', frames: [{ atSeconds: 1.25, image: jpeg }, { atSeconds: 2.5, image: jpeg }] });
const output = () => ({
  observations: [{ frameIndex: 1, kind: 'visible', text: 'The racket is visible beside the body.', confidence: 'medium' }],
  cue: 'One candidate cue', drill: 'Coach-approved rehearsal', successMetric: 'Compare 10 feeds under the same conditions',
  limitations: ['Static frames do not establish swing speed or cause.'], insufficientEvidence: false,
});
const completed = (value: unknown) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const status = (expected: number) => (error: unknown) => error instanceof ContentError && error.status === expected;

test('only consented selected JPEG frames with finite timestamps are accepted', () => {
  const valid = validateAnalysisRequest(request());
  assert.equal(valid.frames[0].atSeconds, 1.25);
  assert.throws(() => validateAnalysisRequest({ ...request(), consent: false }));
  assert.throws(() => validateAnalysisRequest({ ...request(), frames: [] }));
  assert.throws(() => validateAnalysisRequest({ ...request(), frames: Array.from({ length: 7 }, () => request().frames[0]) }));
  for (const atSeconds of [-1, Number.NaN, Infinity]) {
    assert.throws(() => validateAnalysisRequest({ ...request(), frames: [{ atSeconds, image: jpeg }] }));
  }
  for (const image of ['https://private.example/video.mp4', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,YWJjZA==']) {
    assert.throws(() => validateAnalysisRequest({ ...request(), frames: [{ atSeconds: 0, image }] }));
  }
});

test('frame and total JSON caps reject oversized inputs before contacting the provider', async () => {
  const large = Buffer.alloc(MAX_FRAME_BYTES + 1); large[0] = 0xff; large[1] = 0xd8; large[large.length - 2] = 0xff; large[large.length - 1] = 0xd9;
  assert.throws(() => validateAnalysisRequest({ ...request(), frames: [{ atSeconds: 0, image: `data:image/jpeg;base64,${large.toString('base64')}` }] }), status(413));
  const oversized = { ...request(), coachNotes: 'x'.repeat(MAX_ANALYSIS_BYTES) };
  assert.throws(() => validateAnalysisRequest(oversized), status(413));
  let called = false;
  const fetchImpl: typeof fetch = async () => { called = true; return completed(output()); };
  await assert.rejects(analyzeTrainingFrames(oversized, { apiKey: 'test-only-secret', fetchImpl }), status(413));
  assert.equal(called, false);
});

test('result evidence must reference selected frame indexes and maps to exact selected timestamps', () => {
  const valid = validateAnalysisResult(output(), validateAnalysisRequest(request()));
  assert.equal(valid.observations[0].atSeconds, 2.5);
  assert.equal(valid.observations[0].source, 'ai');
  assert.equal(valid.observations[0].kind, 'visible');
  for (const frameIndex of [-1, 2, 0.5]) {
    const invalid = output(); invalid.observations[0].frameIndex = frameIndex;
    assert.throws(() => validateAnalysisResult(invalid, validateAnalysisRequest(request())), status(502));
  }
  assert.throws(() => validateAnalysisResult({ ...output(), insufficientEvidence: 'false' }, validateAnalysisRequest(request())), status(502));
});

test('Responses request sends selected frames with store false and accepts structured evidence', async () => {
  let sent: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    sent = JSON.parse(String(init?.body));
    return completed(output());
  };
  const result = await analyzeTrainingFrames(request(), { apiKey: 'test-only-secret', model: 'test-model', fetchImpl });
  assert.equal(sent!.store, false);
  assert.equal(sent!.model, 'test-model');
  const input = sent!.input as Array<{ content: Array<{ type: string; image_url?: string }> }>;
  assert.equal(input[0].content.filter(part => part.type === 'input_image').length, 2);
  assert.ok(input[0].content.filter(part => part.type === 'input_image').every(part => part.image_url === jpeg));
  assert.equal(result.observations[0].atSeconds, 2.5);
  assert.equal(result.cue, output().cue);
});

test('refusal, incomplete output and bad frame references return clean recoverable errors', async () => {
  const responses = [
    Response.json({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'provider-private-refusal-content' }] }] }),
    Response.json({ status: 'incomplete', output: [] }),
    completed({ ...output(), observations: [{ frameIndex: 99, kind: 'visible', text: 'Unsupported evidence', confidence: 'high' }] }),
  ];
  for (const response of responses) {
    const fetchImpl: typeof fetch = async () => response;
    await assert.rejects(analyzeTrainingFrames(request(), { apiKey: 'test-only-secret', fetchImpl }), (error: unknown) => {
      assert.ok(error instanceof ContentError);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /provider-private|test-only-secret/);
      return true;
    });
  }
});

test('provider failures never expose upstream bodies or credentials', async () => {
  for (const expected of [429, 502]) {
    const fetchImpl: typeof fetch = async () => new Response('provider-private-body test-only-secret', { status: expected === 429 ? 429 : 500 });
    await assert.rejects(analyzeTrainingFrames(request(), { apiKey: 'test-only-secret', fetchImpl }), (error: unknown) => {
      assert.ok(error instanceof ContentError);
      assert.equal(error.status, expected);
      assert.doesNotMatch(error.message, /provider-private-body|test-only-secret/);
      return true;
    });
  }
  const offline: typeof fetch = async () => { throw new Error('network details test-only-secret'); };
  await assert.rejects(analyzeTrainingFrames(request(), { apiKey: 'test-only-secret', fetchImpl: offline }), (error: unknown) => {
    assert.ok(error instanceof ContentError);
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /network details|test-only-secret/);
    return true;
  });
});

test('missing configuration and aborted requests fall back without a live API call', async () => {
  let called = false;
  const unexpected: typeof fetch = async () => { called = true; return completed(output()); };
  await assert.rejects(analyzeTrainingFrames(request(), { apiKey: '', fetchImpl: unexpected }), status(503));
  assert.equal(called, false);
  const waiting: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('mock abort')), { once: true });
  });
  await assert.rejects(analyzeTrainingFrames(request(), { apiKey: 'test-only-secret', fetchImpl: waiting, timeoutMs: 5 }), status(504));
});
