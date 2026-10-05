import { handle, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { MAX_ANALYSIS_BYTES } from '@/lib/training-ai-types';
import { analyzeTeachingLesson } from '@/lib/training-lesson-ai';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    return json(await analyzeTeachingLesson(await readJson(request, MAX_ANALYSIS_BYTES), { apiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.TRAINING_AI_MODEL }));
  });
}
