import { loadConfig, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  owner: z.string().min(1),
});

export function loadConfigJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => loadConfig(deps, schema.parse(data));
}
