import type { MessageRef } from '@standwise/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type DeliveryRow, deliveries } from '../schema';

export type DeliveryKey = {
  installationId: number;
  teamName: string;
  date: string;
  kind: 'digest' | 'late_daily';
  subject?: string;
};

const MAX_ATTEMPTS = 3;
const STALE_PENDING_MINUTES = 10;

const keyFilter = (k: DeliveryKey) =>
  and(
    eq(deliveries.installationId, k.installationId),
    eq(deliveries.teamName, k.teamName),
    eq(deliveries.date, k.date),
    eq(deliveries.kind, k.kind),
    eq(deliveries.subject, k.subject ?? ''),
  );

/**
 * Atomically claims the right to send. Inserts a 'pending' row; on conflict it only reopens a
 * 'failed' row with attempts < 3, or a 'pending' row stale for over 10 minutes (dead worker).
 */
export async function claimDelivery(
  db: Db,
  k: DeliveryKey,
): Promise<'claimed' | 'already_sent' | 'in_progress'> {
  const claimed = await db
    .insert(deliveries)
    .values({
      installationId: k.installationId,
      teamName: k.teamName,
      date: k.date,
      kind: k.kind,
      subject: k.subject ?? '',
      status: 'pending',
      attempts: 1,
    })
    .onConflictDoUpdate({
      target: [
        deliveries.installationId,
        deliveries.teamName,
        deliveries.date,
        deliveries.kind,
        deliveries.subject,
      ],
      set: {
        status: 'pending',
        attempts: sql`${deliveries.attempts} + 1`,
        error: null,
        updatedAt: sql`now()`,
      },
      setWhere: sql`(${deliveries.status} = 'failed' AND ${deliveries.attempts} < ${MAX_ATTEMPTS})
        OR (${deliveries.status} = 'pending'
          AND ${deliveries.updatedAt} < now() - make_interval(mins => ${STALE_PENDING_MINUTES}))`,
    })
    .returning({ id: deliveries.id });
  if (claimed.length > 0) return 'claimed';

  const row = await getDelivery(db, k);
  return row?.status === 'pending' ? 'in_progress' : 'already_sent';
}

export async function completeDelivery(db: Db, k: DeliveryKey, ref: MessageRef): Promise<void> {
  await db
    .update(deliveries)
    .set({ status: 'sent', ref, error: null, updatedAt: sql`now()` })
    .where(keyFilter(k));
}

export async function failDelivery(db: Db, k: DeliveryKey, error: string): Promise<void> {
  await db
    .update(deliveries)
    .set({ status: 'failed', error, updatedAt: sql`now()` })
    .where(keyFilter(k));
}

export async function getDelivery(db: Db, k: DeliveryKey): Promise<DeliveryRow | null> {
  const [row] = await db.select().from(deliveries).where(keyFilter(k));
  return row ?? null;
}

export async function listFailedDeliveries(
  db: Db,
  installationId: number,
  limit: number,
): Promise<DeliveryRow[]> {
  return db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.installationId, installationId), eq(deliveries.status, 'failed')))
    .orderBy(desc(deliveries.updatedAt))
    .limit(limit);
}
