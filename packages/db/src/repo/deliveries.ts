import type { MessageRef } from '@standwise/core';
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type DeliveryRow, deliveries } from '../schema';

export type DeliveryKind =
  | 'digest'
  | 'late_daily'
  | 'reminder'
  | 'blocker_route'
  | 'suggestion_dm'
  | 'signal_scan';

export type DeliveryKey = {
  installationId: number;
  teamName: string;
  date: string;
  kind: DeliveryKind;
  subject?: string;
};

export const MAX_DELIVERY_ATTEMPTS = 3;
const STALE_PENDING_MINUTES = 10;

const keyFilter = (k: DeliveryKey) =>
  and(
    eq(deliveries.installationId, k.installationId),
    eq(deliveries.teamName, k.teamName),
    eq(deliveries.date, k.date),
    eq(deliveries.kind, k.kind),
    eq(deliveries.subject, k.subject ?? ''),
  );

export type ClaimResult =
  | { status: 'claimed'; token: number }
  | { status: 'already_sent' }
  | { status: 'in_progress' };

const staleSql = sql`${deliveries.updatedAt} < now() - make_interval(mins => ${STALE_PENDING_MINUTES})`;

export async function claimDelivery(db: Db, k: DeliveryKey): Promise<ClaimResult> {
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
      setWhere: sql`${deliveries.attempts} < ${MAX_DELIVERY_ATTEMPTS}
        AND (${deliveries.status} = 'failed'
          OR (${deliveries.status} = 'pending' AND ${staleSql}))`,
    })
    .returning({ attempts: deliveries.attempts });
  const first = claimed[0];
  if (first) return { status: 'claimed', token: first.attempts };

  await db
    .update(deliveries)
    .set({
      status: 'failed',
      error: `worker_died: no completion after ${MAX_DELIVERY_ATTEMPTS} attempts`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        keyFilter(k),
        eq(deliveries.status, 'pending'),
        sql`${deliveries.attempts} >= ${MAX_DELIVERY_ATTEMPTS}`,
        staleSql,
      ),
    );

  const row = await getDelivery(db, k);
  return row?.status === 'pending' ? { status: 'in_progress' } : { status: 'already_sent' };
}

export async function completeDelivery(
  db: Db,
  k: DeliveryKey,
  token: number,
  ref: MessageRef,
): Promise<boolean> {
  const rows = await db
    .update(deliveries)
    .set({ status: 'sent', ref, error: null, updatedAt: sql`now()` })
    .where(and(keyFilter(k), eq(deliveries.status, 'pending'), eq(deliveries.attempts, token)))
    .returning({ id: deliveries.id });
  return rows.length > 0;
}

export async function failDelivery(
  db: Db,
  k: DeliveryKey,
  token: number,
  error: string,
): Promise<boolean> {
  const rows = await db
    .update(deliveries)
    .set({ status: 'failed', error, updatedAt: sql`now()` })
    .where(and(keyFilter(k), eq(deliveries.status, 'pending'), eq(deliveries.attempts, token)))
    .returning({ id: deliveries.id });
  return rows.length > 0;
}

export async function markDeliverySent(db: Db, k: DeliveryKey): Promise<void> {
  await db
    .insert(deliveries)
    .values({
      installationId: k.installationId,
      teamName: k.teamName,
      date: k.date,
      kind: k.kind,
      subject: k.subject ?? '',
      status: 'sent',
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
      set: { status: 'sent', error: null, updatedAt: sql`now()` },
    });
}

export async function getDelivery(db: Db, k: DeliveryKey): Promise<DeliveryRow | null> {
  const [row] = await db.select().from(deliveries).where(keyFilter(k));
  return row ?? null;
}

export type PersonDeliveryKind = Extract<DeliveryKind, 'reminder' | 'signal_scan'>;

export async function listPersonDeliveries(
  db: Db,
  installationId: number,
  date: string,
  kind: PersonDeliveryKind,
): Promise<DeliveryRow[]> {
  return db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.installationId, installationId),
        eq(deliveries.date, date),
        eq(deliveries.kind, kind),
      ),
    );
}

const ROUTE_RESERVATION = '+';

export type BlockerRouteReservation =
  | { status: 'capped' }
  | { status: 'reserved'; recipients: Set<string> | null };

export async function reserveBlockerRoute(
  db: Db,
  k: { installationId: number; date: string; dailyId: string; blockerId: string; limit: number },
): Promise<BlockerRouteReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${k.installationId}:${k.dailyId}`}))`,
    );
    const rows = await tx
      .select({
        id: sql<string>`split_part(${deliveries.subject}, ':', 2)`,
        recipient: sql<string>`split_part(${deliveries.subject}, ':', 3)`,
      })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.installationId, k.installationId),
          eq(deliveries.date, k.date),
          eq(deliveries.kind, 'blocker_route'),
          sql`split_part(${deliveries.subject}, ':', 1) = ${k.dailyId}`,
        ),
      );
    const ids = new Set(rows.map((r) => r.id));
    if (ids.has(k.blockerId)) {
      const recipients = new Set(
        rows
          .filter((r) => r.id === k.blockerId && r.recipient !== ROUTE_RESERVATION)
          .map((r) => r.recipient),
      );
      return { status: 'reserved', recipients: recipients.size > 0 ? recipients : null };
    }
    if (ids.size >= k.limit) return { status: 'capped' };
    await tx
      .insert(deliveries)
      .values({
        installationId: k.installationId,
        teamName: '',
        date: k.date,
        kind: 'blocker_route',
        subject: `${k.dailyId}:${k.blockerId}:${ROUTE_RESERVATION}`,
        status: 'sent',
        attempts: 1,
      })
      .onConflictDoNothing();
    return { status: 'reserved', recipients: null };
  });
}

export const ADMIN_VISIBLE_DELIVERY_KINDS = [
  'digest',
  'late_daily',
  'reminder',
  'blocker_route',
] as const satisfies readonly DeliveryKind[];

export async function listFailedDeliveries(
  db: Db,
  installationId: number,
  limit: number,
): Promise<DeliveryRow[]> {
  return db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.installationId, installationId),
        eq(deliveries.status, 'failed'),
        inArray(deliveries.kind, [...ADMIN_VISIBLE_DELIVERY_KINDS]),
      ),
    )
    .orderBy(desc(deliveries.updatedAt))
    .limit(limit);
}

export type DigestPageFilter = {
  team?: string;
  from?: string;
  to?: string;
  after?: { date: string; id: string };
  limit: number;
};

export async function listDigestDeliveries(
  db: Db,
  installationId: number,
  f: DigestPageFilter,
): Promise<DeliveryRow[]> {
  const { after } = f;
  return db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.installationId, installationId),
        eq(deliveries.kind, 'digest'),
        f.team ? eq(deliveries.teamName, f.team) : undefined,
        f.from ? gte(deliveries.date, f.from) : undefined,
        f.to ? lte(deliveries.date, f.to) : undefined,
        after
          ? or(
              lt(deliveries.date, after.date),
              and(eq(deliveries.date, after.date), lt(deliveries.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(deliveries.date), desc(deliveries.id))
    .limit(f.limit);
}
