import { randomUUID } from 'node:crypto';
import {
  getInstallation,
  insertWebhookDeliveries,
  listSubscribedWebhookEndpoints,
} from '@standwise/db';
import type { Deps } from '../deps';
import type { DeliverableEvent, Envelope, WebhookEvent } from '../events';

export const DELIVER_WEBHOOK_JOB = 'deliver-webhook';

export type EmitDeps = Pick<Deps, 'db' | 'queue' | 'now'>;

export async function enqueueEnvelope(
  deps: EmitDeps,
  installationId: number,
  event: DeliverableEvent,
  endpointIds: string[],
  id: string = randomUUID(),
): Promise<string[]> {
  if (endpointIds.length === 0) return [];
  const installation = await getInstallation(deps.db, installationId);
  if (!installation) return [];
  const now = deps.now();
  const envelope: Envelope = {
    id,
    type: event.type,
    created_at: now.toISOString(),
    installation: { id: installation.id, login: installation.accountLogin },
    data: event.data,
  };
  const deliveryIds = await insertWebhookDeliveries(
    deps.db,
    endpointIds.map((endpointId) => ({
      endpointId,
      event: event.type,
      eventId: id,
      payload: envelope,
      nextAttemptAt: now,
      createdAt: now,
    })),
  );
  for (const deliveryId of deliveryIds) {
    await deps.queue.enqueue(DELIVER_WEBHOOK_JOB, { deliveryId });
  }
  return deliveryIds;
}

export async function emitEvent(
  deps: EmitDeps,
  installationId: number,
  event: WebhookEvent,
  options: { id?: string } = {},
): Promise<void> {
  const endpointIds = await listSubscribedWebhookEndpoints(deps.db, installationId, event.type);
  await enqueueEnvelope(deps, installationId, event, endpointIds, options.id);
}

export async function emitEventSafely(
  deps: EmitDeps,
  installationId: number,
  event: WebhookEvent,
): Promise<void> {
  try {
    await emitEvent(deps, installationId, event);
  } catch (error) {
    console.error(`webhook event ${event.type} not emitted`, error);
  }
}
