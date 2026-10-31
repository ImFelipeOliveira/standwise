import { linkTrackerIdentity, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({ installationId: z.number().int(), memberId: z.uuid() });

export function linkTrackerIdentityJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => {
    const job = schema.parse(data);
    return linkTrackerIdentity(deps, job.installationId, job.memberId);
  };
}
