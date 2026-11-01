import { validateConfigAtRef, type WorkerDeps } from '@standcast/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  owner: z.string().min(1),
  headSha: z.string().min(1),
  pullNumber: z.number().int().positive().optional(),
});

export function validateConfigJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return async (data) => {
    await validateConfigAtRef(deps, schema.parse(data));
  };
}
