import { routeBlocker, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  dailyId: z.string().min(1),
  blockerIndex: z.number().int().nonnegative(),
  blockerId: z.string().min(1).optional(),
});

export function routeBlockerJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => routeBlocker(deps, schema.parse(data));
}
