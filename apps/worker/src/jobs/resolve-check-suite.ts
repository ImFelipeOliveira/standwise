import {
  MAX_CHECK_SUITE_LOOKUPS,
  resolveCheckSuite,
  type WorkerDeps,
} from '@standcast/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  numbers: z.array(z.number().int().positive()).max(MAX_CHECK_SUITE_LOOKUPS),
});

export function resolveCheckSuiteJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => resolveCheckSuite(deps, schema.parse(data));
}
