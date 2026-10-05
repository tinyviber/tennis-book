import { handle, json, readJson, revision } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { readTrainingBootstrap, restoreTrainingRecords } from '@/lib/training-store';
import { MAX_TRAINING_RESTORE_BYTES } from '@/lib/training-limits';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    const body = await readJson(request, MAX_TRAINING_RESTORE_BYTES);
    const result = await restoreTrainingRecords(body.backup, revision(body.revision));
    const bootstrap = await readTrainingBootstrap();
    return json({ ...bootstrap, ...result });
  });
}
