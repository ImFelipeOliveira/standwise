import { scanMemberSignals, type WorkerDeps } from '@standcast/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  login: z.string().min(1),
  date: z.iso.date().optional(),
});

export function scanMemberSignalsJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => scanMemberSignals(deps, schema.parse(data));
}
