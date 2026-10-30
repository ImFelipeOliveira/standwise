import { and, arrayContains, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { decryptSecret, encryptSecret } from '../crypto';
import {
  type WebhookDeliveryEvent,
  type WebhookDeliveryRow,
  type WebhookDeliveryStatus,
  type WebhookDisabledReason,
  type WebhookEventType,
  webhookDeliveries,
  webhookEndpoints,
} from '../schema';

export type WebhookEndpointSummary = {
  id: string;
  url: string;
  events: WebhookEventType[];
  active: boolean;
  disabledReason: WebhookDisabledReason | null;
  consecutiveFailures: number;
  createdAt: Date;
};

export type WebhookDeliverySummary = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  event: WebhookDeliveryEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
};

export type ClaimedWebhookDelivery = {
  id: string;
  endpointId: string;
  installationId: number;
  url: string;
  secretCiphertext: string;
  active: boolean;
  event: WebhookDeliveryEvent;
  payload: unknown;
  attempts: number;
};

export type NewWebhookDelivery = {
  endpointId: string;
  event: WebhookDeliveryEvent;
  eventId: string;
  payload: unknown;
  nextAttemptAt: Date;
  createdAt?: Date;
};

const summaryColumns = {
  id: webhookEndpoints.id,
  url: webhookEndpoints.url,
  events: webhookEndpoints.events,
  active: webhookEndpoints.active,
  disabledReason: webhookEndpoints.disabledReason,
  consecutiveFailures: webhookEndpoints.consecutiveFailures,
  createdAt: webhookEndpoints.createdAt,
};

export async function insertWebhookEndpoint(
  db: Db,
  p: { installationId: number; url: string; events: WebhookEventType[]; secret: string },
  key: Uint8Array,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      installationId: p.installationId,
      url: p.url,
      events: p.events,
      secretCiphertext: encryptSecret(p.secret, key),
    })
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new Error('insertWebhookEndpoint returned no row');
  return row;
}

export async function listInstallationWebhookEndpoints(
  db: Db,
  installationId: number,
): Promise<WebhookEndpointSummary[]> {
  return db
    .select(summaryColumns)
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.installationId, installationId))
    .orderBy(desc(webhookEndpoints.createdAt), webhookEndpoints.id);
}

export async function getWebhookEndpoint(
  db: Db,
  installationId: number,
  id: string,
): Promise<WebhookEndpointSummary | null> {
  const [row] = await db
    .select(summaryColumns)
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.installationId, installationId), eq(webhookEndpoints.id, id)));
  return row ?? null;
}

export async function getWebhookEndpointSecret(
  db: Db,
  installationId: number,
  id: string,
  key: Uint8Array,
): Promise<string | null> {
  const [row] = await db
    .select({ secretCiphertext: webhookEndpoints.secretCiphertext })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.installationId, installationId), eq(webhookEndpoints.id, id)));
  return row ? decryptSecret(row.secretCiphertext, key) : null;
}

export async function deactivateWebhookEndpoint(
  db: Db,
  installationId: number,
  id: string,
  reason: WebhookDisabledReason,
): Promise<boolean> {
  const rows = await db
    .update(webhookEndpoints)
    .set({ active: false, disabledReason: reason })
    .where(
      and(
        eq(webhookEndpoints.installationId, installationId),
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.active, true),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  return rows.length > 0;
}

export async function listSubscribedWebhookEndpoints(
  db: Db,
  installationId: number,
  event: WebhookEventType,
): Promise<string[]> {
  const rows = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.installationId, installationId),
        eq(webhookEndpoints.active, true),
        arrayContains(webhookEndpoints.events, [event]),
      ),
    )
    .orderBy(asc(webhookEndpoints.createdAt), webhookEndpoints.id);
  return rows.map((r) => r.id);
}

export async function insertWebhookDeliveries(
  db: Db,
  rows: NewWebhookDelivery[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(webhookDeliveries)
    .values(rows)
    .onConflictDoNothing({ target: [webhookDeliveries.endpointId, webhookDeliveries.eventId] })
    .returning({ id: webhookDeliveries.id });
  return inserted.map((r) => r.id);
}

export async function getWebhookDelivery(db: Db, id: string): Promise<WebhookDeliveryRow | null> {
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
  return row ?? null;
}

export async function claimWebhookDelivery(
  db: Db,
  id: string,
  now: Date,
  leaseMs: number,
  maxAttempts?: number,
): Promise<ClaimedWebhookDelivery | null> {
  const [claimed] = await db
    .update(webhookDeliveries)
    .set({
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      nextAttemptAt: new Date(now.getTime() + leaseMs),
    })
    .where(
      and(
        eq(webhookDeliveries.id, id),
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextAttemptAt, now),
        maxAttempts === undefined ? undefined : lt(webhookDeliveries.attempts, maxAttempts),
      ),
    )
    .returning({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      event: webhookDeliveries.event,
      payload: webhookDeliveries.payload,
      attempts: webhookDeliveries.attempts,
    });
  if (!claimed) {
    if (maxAttempts !== undefined) {
      await db
        .update(webhookDeliveries)
        .set({ status: 'failed', lastError: 'worker_died' })
        .where(
          and(
            eq(webhookDeliveries.id, id),
            eq(webhookDeliveries.status, 'pending'),
            lte(webhookDeliveries.nextAttemptAt, now),
            gte(webhookDeliveries.attempts, maxAttempts),
          ),
        );
    }
    return null;
  }
  const [endpoint] = await db
    .select({
      installationId: webhookEndpoints.installationId,
      url: webhookEndpoints.url,
      secretCiphertext: webhookEndpoints.secretCiphertext,
      active: webhookEndpoints.active,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, claimed.endpointId));
  if (!endpoint) return null;
  return { ...claimed, ...endpoint };
}

const pendingWithToken = (id: string, token: number) =>
  and(
    eq(webhookDeliveries.id, id),
    eq(webhookDeliveries.status, 'pending'),
    eq(webhookDeliveries.attempts, token),
  );

export async function completeWebhookDelivery(
  db: Db,
  id: string,
  token: number,
  statusCode: number,
): Promise<boolean> {
  const [row] = await db
    .update(webhookDeliveries)
    .set({ status: 'delivered', lastStatusCode: statusCode, lastError: null })
    .where(pendingWithToken(id, token))
    .returning({ endpointId: webhookDeliveries.endpointId });
  if (!row) return false;
  await db
    .update(webhookEndpoints)
    .set({ consecutiveFailures: 0 })
    .where(eq(webhookEndpoints.id, row.endpointId));
  return true;
}

export type WebhookAttemptOutcome = { statusCode: number | null; error: string };

export async function retryWebhookDelivery(
  db: Db,
  id: string,
  token: number,
  outcome: WebhookAttemptOutcome & { nextAttemptAt: Date },
): Promise<boolean> {
  const rows = await db
    .update(webhookDeliveries)
    .set({
      lastStatusCode: outcome.statusCode,
      lastError: outcome.error,
      nextAttemptAt: outcome.nextAttemptAt,
    })
    .where(pendingWithToken(id, token))
    .returning({ id: webhookDeliveries.id });
  return rows.length > 0;
}

export async function failWebhookDelivery(
  db: Db,
  id: string,
  token: number,
  outcome: WebhookAttemptOutcome,
  disableAfter: number | null,
): Promise<{ failed: boolean; endpointDisabled: boolean }> {
  const [row] = await db
    .update(webhookDeliveries)
    .set({ status: 'failed', lastStatusCode: outcome.statusCode, lastError: outcome.error })
    .where(pendingWithToken(id, token))
    .returning({ endpointId: webhookDeliveries.endpointId });
  if (!row) return { failed: false, endpointDisabled: false };
  if (disableAfter === null) return { failed: true, endpointDisabled: false };
  const reached = sql`${webhookEndpoints.consecutiveFailures} + 1 >= ${disableAfter}`;
  const [endpoint] = await db
    .update(webhookEndpoints)
    .set({
      consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
      disabledReason: sql`CASE WHEN ${reached} AND ${webhookEndpoints.active} THEN 'failures' ELSE ${webhookEndpoints.disabledReason} END`,
      active: sql`CASE WHEN ${reached} THEN false ELSE ${webhookEndpoints.active} END`,
    })
    .where(eq(webhookEndpoints.id, row.endpointId))
    .returning({ consecutiveFailures: webhookEndpoints.consecutiveFailures });
  return {
    failed: true,
    endpointDisabled: (endpoint?.consecutiveFailures ?? 0) >= disableAfter,
  };
}

export async function listRecentWebhookDeliveries(
  db: Db,
  installationId: number,
  limit: number,
): Promise<WebhookDeliverySummary[]> {
  return db
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      endpointUrl: webhookEndpoints.url,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookEndpoints.installationId, installationId))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit);
}

export async function listOverdueWebhookDeliveries(
  db: Db,
  before: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, before)),
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(limit);
  return rows.map((r) => r.id);
}
