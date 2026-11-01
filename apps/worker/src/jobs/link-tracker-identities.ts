import { linkTrackerIdentities, type WorkerDeps } from '@standcast/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  afterLogin: z.string().optional(),
});

export function linkTrackerIdentitiesJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => {
    const job = schema.parse(data);
    return linkTrackerIdentities(deps, job.installationId, job.afterLogin);
  };
}
