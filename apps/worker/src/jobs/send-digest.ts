import { sendDigest, type WorkerDeps } from '@standcast/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  teamName: z.string().min(1),
  date: z.iso.date(),
});

export function sendDigestJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => sendDigest(deps, schema.parse(data));
}
