import { handle, json } from '@/lib/api';
import { requireAdmin } from '@/lib/server-auth';
import { exportTrainingRecords } from '@/lib/training-store';

export const runtime = 'nodejs';
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const response = json(await exportTrainingRecords());
    response.headers.set('Content-Disposition', 'attachment; filename="tennis-training-records.json"');
    return response;
  });
}
