import { notifyBetaRequest, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({ requestId: z.uuid() });

export function notifyBetaRequestJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return async (data) => notifyBetaRequest(deps, schema.parse(data));
}
