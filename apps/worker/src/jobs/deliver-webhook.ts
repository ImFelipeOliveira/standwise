import { deliverWebhook, requeueWebhookDeliveries, type WorkerDeps } from '@standwise/orchestrator';
import { z } from 'zod';

const schema = z.object({ deliveryId: z.uuid() });

export function deliverWebhookJob(deps: WorkerDeps): (data: object) => Promise<void> {
  return async (data) => deliverWebhook(deps, schema.parse(data));
}

export function requeueWebhooksJob(deps: WorkerDeps): () => Promise<void> {
  return async () => {
    await requeueWebhookDeliveries(deps);
  };
}
