import { handle, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { analyzeTrainingFrames } from '@/lib/training-ai';
import { MAX_ANALYSIS_BYTES } from '@/lib/training-ai-types';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    const value = await readJson(request, MAX_ANALYSIS_BYTES);
    return json(await analyzeTrainingFrames(value, { apiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.TRAINING_AI_MODEL }));
  });
}
