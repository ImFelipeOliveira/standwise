import { sendReminder, type WorkerDeps } from '@standcast/orchestrator';
import { z } from 'zod';

const schema = z.object({
  installationId: z.number().int(),
  login: z.string().min(1),
  date: z.iso.date(),
});

export function sendReminderJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return (data) => sendReminder(deps, schema.parse(data));
}
