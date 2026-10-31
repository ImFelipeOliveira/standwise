import { linkTrackerIdentities, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({ installationId: z.number().int() });

export function linkTrackerIdentitiesJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => linkTrackerIdentities(deps, schema.parse(data).installationId);
}
