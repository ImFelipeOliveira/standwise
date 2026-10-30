import {
  claimWebhookDelivery,
  completeWebhookDelivery,
  decryptSecret,
  failWebhookDelivery,
  listOverdueWebhookDeliveries,
  retryWebhookDelivery,
  type WebhookAttemptOutcome,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';
import { SafeFetchError, safeFetch } from '../safe-fetch';
import { signWebhook } from '../webhook-sign';
import { DELIVER_WEBHOOK_JOB } from './emit-event';

const MINUTE = 60_000;

export const WEBHOOK_BACKOFF_MS = [1, 5, 30, 120, 360, 720, 1440].map((m) => m * MINUTE);
export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_BACKOFF_MS.length + 1;
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_USER_AGENT = 'Standwise-Webhooks/1';

const LEASE_MS = 5 * MINUTE;
const OVERDUE_MS = 2 * MINUTE;
const REQUEUE_BATCH = 500;

export type DeliverWebhookJob = { deliveryId: string };

type AttemptResult = { ok: true; statusCode: number } | ({ ok: false } & WebhookAttemptOutcome);

function describeFailure(error: unknown): string {
  if (error instanceof SafeFetchError) return error.code;
  return 'internal';
}

async function attempt(
  deps: WorkerDeps,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<AttemptResult> {
  try {
    const response = await safeFetch(
      url,
      { method: 'POST', headers, body },
      { ...deps.webhookTransport, timeoutMs: WEBHOOK_TIMEOUT_MS },
    );
    await response.body?.cancel().catch(() => {});
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, statusCode: response.status };
    }
    return { ok: false, statusCode: response.status, error: `http_${response.status}` };
  } catch (error) {
    if (!(error instanceof SafeFetchError)) logError('webhook attempt failed', error);
    return { ok: false, statusCode: null, error: describeFailure(error) };
  }
}

export async function deliverWebhook(deps: WorkerDeps, job: DeliverWebhookJob): Promise<void> {
  const now = deps.now();
  const claim = await claimWebhookDelivery(
    deps.db,
    job.deliveryId,
    now,
    LEASE_MS,
    MAX_WEBHOOK_ATTEMPTS,
  );
  if (!claim) return;
  if (!claim.active) {
    await failWebhookDelivery(
      deps.db,
      claim.id,
      claim.attempts,
      { statusCode: null, error: 'endpoint_disabled' },
      null,
    );
    return;
  }
  const secret = decryptSecret(claim.secretCiphertext, deps.encryptionKey);
  const body = JSON.stringify(claim.payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': WEBHOOK_USER_AGENT,
    'Standwise-Event': claim.event,
    'Standwise-Delivery': claim.id,
    'Standwise-Signature': signWebhook(secret, body, Math.floor(now.getTime() / 1000)),
  };
  const result = await attempt(deps, claim.url, headers, body);
  if (result.ok) {
    await completeWebhookDelivery(deps.db, claim.id, claim.attempts, result.statusCode);
    return;
  }
  const delay = WEBHOOK_BACKOFF_MS[claim.attempts - 1];
  if (delay === undefined) {
    await failWebhookDelivery(
      deps.db,
      claim.id,
      claim.attempts,
      result,
      WEBHOOK_DISABLE_AFTER_FAILURES,
    );
    return;
  }
  const nextAttemptAt = new Date(now.getTime() + delay);
  if (
    await retryWebhookDelivery(deps.db, claim.id, claim.attempts, {
      statusCode: result.statusCode,
      error: result.error,
      nextAttemptAt,
    })
  ) {
    await deps.queue.enqueue(
      DELIVER_WEBHOOK_JOB,
      { deliveryId: claim.id },
      { startAfter: nextAttemptAt },
    );
  }
}

export async function requeueWebhookDeliveries(deps: WorkerDeps): Promise<number> {
  const before = new Date(deps.now().getTime() - OVERDUE_MS);
  const ids = await listOverdueWebhookDeliveries(deps.db, before, REQUEUE_BATCH);
  for (const deliveryId of ids) {
    await deps.queue.enqueue(DELIVER_WEBHOOK_JOB, { deliveryId });
  }
  return ids.length;
}
