import { sendLateDaily, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  memberId: z.uuid(),
  date: z.iso.date(),
});

export function sendLateDailyJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => sendLateDaily(deps, schema.parse(data));
}
