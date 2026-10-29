import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type MemberRow, members, sessions } from '../schema';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Returns the token ("sw_" + base64url of 32 random bytes); only its sha256 hex is stored. */
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
  const [row] = await db
    .update(sessions)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.kind, kind)))
    .returning({ memberId: sessions.memberId });
  if (!row) return null;
  const [member] = await db.select().from(members).where(eq(members.id, row.memberId));
  return member ?? null;
}
