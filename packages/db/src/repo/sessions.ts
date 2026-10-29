import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type MemberRow, members, sessions } from '../schema';

const WEB_TTL_DAYS = 7;
const CLI_IDLE_DAYS = 90;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(
  db: Db,
  memberId: string,
  kind: 'cli' | 'web',
): Promise<string> {
  const token = `sw_${randomBytes(32).toString('base64url')}`;
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
