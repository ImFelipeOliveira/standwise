import { and, eq, isNull, lt, lte } from 'drizzle-orm';
import type { Db } from '../client';
import { betaRequests } from '../schema';

export type BetaTeamSize = '3-5' | '6-15' | '16+';
export type BetaChat = 'slack' | 'google_chat' | 'other';
export type BetaTracker = 'linear' | 'jira' | 'github' | 'other';
export type BetaLocale = 'en' | 'pt-BR';

export type BetaRequestInput = {
  name: string;
  email: string;
  teamSize: BetaTeamSize;
  chat: BetaChat;
  tracker: BetaTracker;
  locale: BetaLocale;
};

export type BetaRequest = BetaRequestInput & {
  id: string;
  createdAt: Date;
  notifiedAt: Date | null;
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function upsertBetaRequest(
  db: Db,
  input: BetaRequestInput,
  now: Date,
): Promise<{ id: string } | null> {
  const values = {
    name: input.name,
    email: input.email.trim().toLowerCase(),
    teamSize: input.teamSize,
    chat: input.chat,
    tracker: input.tracker,
    locale: input.locale,
    createdAt: now,
    notifiedAt: null,
  };
  const rows = await db
    .insert(betaRequests)
    .values(values)
    .onConflictDoUpdate({
      target: betaRequests.email,
      set: values,
      setWhere: lte(betaRequests.createdAt, new Date(now.getTime() - WINDOW_MS)),
    })
    .returning({ id: betaRequests.id });
  return rows[0] ?? null;
}

export async function getBetaRequest(db: Db, id: string): Promise<BetaRequest | null> {
  const rows = await db.select().from(betaRequests).where(eq(betaRequests.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    teamSize: row.teamSize as BetaTeamSize,
    chat: row.chat as BetaChat,
    tracker: row.tracker as BetaTracker,
    locale: row.locale as BetaLocale,
    createdAt: row.createdAt,
    notifiedAt: row.notifiedAt,
  };
}

export async function markBetaRequestNotified(db: Db, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(betaRequests)
    .set({ notifiedAt: now })
    .where(and(eq(betaRequests.id, id), isNull(betaRequests.notifiedAt)))
    .returning({ id: betaRequests.id });
  return rows.length > 0;
}

export async function deleteBetaRequestsCreatedBefore(db: Db, cutoff: Date): Promise<number> {
  const rows = await db
    .delete(betaRequests)
    .where(lt(betaRequests.createdAt, cutoff))
    .returning({ id: betaRequests.id });
  return rows.length;
}
