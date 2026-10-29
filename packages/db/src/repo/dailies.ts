import type { DailySubmission } from '@standwise/core';
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
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
): Promise<{ id: string }> {
  const [row] = await db
    .insert(dailies)
    .values(d)
    .onConflictDoUpdate({
      target: [dailies.installationId, dailies.memberId, dailies.date],
      set: { payload: d.payload, submittedAt: d.submittedAt },
    })
    .returning({ id: dailies.id });
  if (!row) throw new Error('upsertDaily returned no row');
  return row;
}

export async function getMemberDaily(
  db: Db,
  installationId: number,
  memberId: string,
  date: string,
): Promise<{ id: string; payload: DailySubmission } | null> {
  const [row] = await db
    .select({ id: dailies.id, payload: dailies.payload })
    .from(dailies)
    .where(
      and(
        eq(dailies.installationId, installationId),
        eq(dailies.memberId, memberId),
        eq(dailies.date, date),
      ),
    );
  return row ?? null;
}

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

export type DailyCursor = { date: string; id: string };

export type DailyRecord = {
  id: string;
  login: string;
  date: string;
  payload: DailySubmission;
  submittedAt: Date;
};

export type DailyPageFilter = {
  date?: string;
  from?: string;
  to?: string;
  logins?: string[];
  after?: DailyCursor;
  includeAfter?: boolean;
  withBlockers?: boolean;
  limit: number;
};

const recordColumns = {
  id: dailies.id,
  login: members.login,
  date: dailies.date,
  payload: dailies.payload,
  submittedAt: dailies.submittedAt,
};

export async function listDailiesPage(
  db: Db,
  installationId: number,
  f: DailyPageFilter,
): Promise<DailyRecord[]> {
  if (f.logins && f.logins.length === 0) return [];
  const { after } = f;
  return db
    .select(recordColumns)
    .from(dailies)
    .innerJoin(members, eq(members.id, dailies.memberId))
    .where(
      and(
        eq(dailies.installationId, installationId),
        f.date ? eq(dailies.date, f.date) : undefined,
        f.from ? gte(dailies.date, f.from) : undefined,
        f.to ? lte(dailies.date, f.to) : undefined,
        f.logins ? inArray(sql`lower(${members.login})`, f.logins) : undefined,
        f.withBlockers ? sql`jsonb_array_length(${dailies.payload}->'blockers') > 0` : undefined,
        after
          ? or(
              lt(dailies.date, after.date),
              and(
                eq(dailies.date, after.date),
                f.includeAfter ? lte(dailies.id, after.id) : lt(dailies.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(dailies.date), desc(dailies.id))
    .limit(f.limit);
}

export async function getDailyById(
  db: Db,
  installationId: number,
  id: string,
): Promise<DailyRecord | null> {
  const [row] = await db
    .select(recordColumns)
    .from(dailies)
    .innerJoin(members, eq(members.id, dailies.memberId))
    .where(and(eq(dailies.installationId, installationId), eq(dailies.id, id)));
  return row ?? null;
}

export async function listSubmitters(
  db: Db,
  installationId: number,
  dates: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (dates.length === 0) return result;
  const rows = await db
    .select({ date: dailies.date, login: members.login })
    .from(dailies)
    .innerJoin(members, eq(members.id, dailies.memberId))
    .where(and(eq(dailies.installationId, installationId), inArray(dailies.date, dates)));
  for (const row of rows) {
    const set = result.get(row.date) ?? new Set<string>();
    set.add(row.login.toLowerCase());
    result.set(row.date, set);
  }
  return result;
}
