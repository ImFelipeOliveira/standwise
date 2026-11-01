import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type MemberRow, members, sessions } from '../schema';
import { PRUNE_BATCH } from './prune-batch';

const WEB_TTL_DAYS = 7;
const CLI_IDLE_DAYS = 90;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(
  db: Db,
  memberId: string,
  kind: 'cli' | 'web',
): Promise<string> {
  const token = `sc_${randomBytes(32).toString('base64url')}`;
  await db.insert(sessions).values({ tokenHash: hash(token), memberId, kind });
  return token;
}

export async function resolveSession(
  db: Db,
  token: string,
  kind: 'cli' | 'web',
): Promise<MemberRow | null> {
  const tokenHash = hash(token);
  const fresh =
    kind === 'web'
      ? sql`${sessions.createdAt} > now() - make_interval(days => ${WEB_TTL_DAYS})`
      : sql`${sessions.lastUsedAt} > now() - make_interval(days => ${CLI_IDLE_DAYS})`;
  const [row] = await db
    .update(sessions)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.kind, kind), fresh))
    .returning({ memberId: sessions.memberId });
  if (!row) return null;
  const [member] = await db.select().from(members).where(eq(members.id, row.memberId));
  return member ?? null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
}

export async function deleteExpiredSessions(db: Db, now: Date): Promise<number> {
  const day = 24 * 60 * 60 * 1000;
  const webCutoff = new Date(now.getTime() - WEB_TTL_DAYS * day);
  const cliCutoff = new Date(now.getTime() - CLI_IDLE_DAYS * day);
  let total = 0;
  for (;;) {
    const rows = await db
      .delete(sessions)
      .where(
        inArray(
          sessions.tokenHash,
          db
            .select({ tokenHash: sessions.tokenHash })
            .from(sessions)
            .where(
              or(
                and(eq(sessions.kind, 'web'), lt(sessions.createdAt, webCutoff)),
                and(eq(sessions.kind, 'cli'), lt(sessions.lastUsedAt, cliCutoff)),
              ),
            )
            .limit(PRUNE_BATCH),
        ),
      )
      .returning({ tokenHash: sessions.tokenHash });
    total += rows.length;
    if (rows.length === 0) return total;
  }
}
