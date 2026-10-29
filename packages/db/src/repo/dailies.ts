import type { DailySubmission } from '@standwise/core';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../client';
import { dailies, members } from '../schema';

export async function upsertDaily(
  db: Db,
  d: {
    installationId: number;
    memberId: string;
    date: string;
    payload: DailySubmission;
    submittedAt: Date;
  },
): Promise<void> {
  await db
    .insert(dailies)
    .values(d)
    .onConflictDoUpdate({
      target: [dailies.installationId, dailies.memberId, dailies.date],
      set: { payload: d.payload, submittedAt: d.submittedAt },
    });
}

/** Most recent daily with date strictly before `before`. */
export async function getLastDaily(
  db: Db,
  installationId: number,
  memberId: string,
  before: string,
): Promise<{ date: string; submittedAt: Date } | null> {
  const [row] = await db
    .select({ date: dailies.date, submittedAt: dailies.submittedAt })
    .from(dailies)
    .where(
      and(
        eq(dailies.installationId, installationId),
        eq(dailies.memberId, memberId),
        lt(dailies.date, before),
      ),
    )
    .orderBy(desc(dailies.date))
    .limit(1);
  return row ?? null;
}

export async function listDailies(
  db: Db,
  installationId: number,
  date: string,
): Promise<{ login: string; memberId: string; payload: DailySubmission; submittedAt: Date }[]> {
  return db
    .select({
      login: members.login,
      memberId: dailies.memberId,
      payload: dailies.payload,
      submittedAt: dailies.submittedAt,
    })
    .from(dailies)
    .innerJoin(members, eq(members.id, dailies.memberId))
    .where(and(eq(dailies.installationId, installationId), eq(dailies.date, date)))
    .orderBy(dailies.submittedAt);
}
