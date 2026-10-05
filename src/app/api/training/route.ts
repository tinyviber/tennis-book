import { handle, json, readJson, revision } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { MAX_TRAINING_STATE_BYTES, readTrainingBootstrap, saveTrainingState } from '@/lib/training-store';

export const runtime = 'nodejs';
export async function GET() {
  return handle(async () => { await requireAdmin(); return json(await readTrainingBootstrap()); });
}
export async function PUT(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    const body = await readJson(request, MAX_TRAINING_STATE_BYTES + 8192);
    const document = await saveTrainingState(body.state, revision(body.revision));
    const bootstrap = await readTrainingBootstrap();
    return json({ ...bootstrap, ...document });
  });
}
