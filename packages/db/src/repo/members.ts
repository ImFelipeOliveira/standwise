import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  installations,
  type MemberRow,
  memberIdentities,
  memberInstallations,
  members,
  type Provider,
} from '../schema';

export async function upsertMember(
  db: Db,
  m: { githubUserId: number; login: string; email: string | null },
): Promise<MemberRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(members)
      .set({ login: sql`'~' || ${members.githubUserId}` })
      .where(
        and(
          sql`lower(${members.login}) = lower(${m.login})`,
          ne(members.githubUserId, m.githubUserId),
        ),
      );
    const [row] = await tx
      .insert(members)
      .values(m)
      .onConflictDoUpdate({
        target: members.githubUserId,
        set: { login: m.login, email: m.email },
      })
      .returning();
    if (!row) throw new Error('upsertMember returned no row');
    return row;
  });
}

export async function setMemberInstallations(
  db: Db,
  memberId: string,
  installationIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(memberInstallations).where(eq(memberInstallations.memberId, memberId));
    if (installationIds.length > 0) {
      await tx
        .insert(memberInstallations)
        .values(installationIds.map((installationId) => ({ memberId, installationId })));
    }
  });
}

export async function setIdentity(
  db: Db,
  installationId: number,
  memberId: string,
  provider: Provider,
  externalId: string,
): Promise<void> {
  await db
    .insert(memberIdentities)
    .values({ installationId, memberId, provider, externalId })
    .onConflictDoUpdate({
      target: [
        memberIdentities.installationId,
        memberIdentities.memberId,
        memberIdentities.provider,
      ],
      set: { externalId },
    });
}

export async function getIdentities(
  db: Db,
  installationId: number,
  provider: Provider,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ login: members.login, externalId: memberIdentities.externalId })
    .from(memberIdentities)
    .innerJoin(members, eq(members.id, memberIdentities.memberId))
    .where(
      and(
        eq(memberIdentities.installationId, installationId),
        eq(memberIdentities.provider, provider),
      ),
    );
  return new Map(rows.map((r) => [r.login.toLowerCase(), r.externalId]));
}

export async function getMemberById(db: Db, id: string): Promise<MemberRow | null> {
  const [row] = await db.select().from(members).where(eq(members.id, id));
  return row ?? null;
}

export async function listMemberInstallations(
  db: Db,
  memberId: string,
): Promise<{ installationId: number; accountLogin: string }[]> {
  return db
    .select({ installationId: installations.id, accountLogin: installations.accountLogin })
    .from(memberInstallations)
    .innerJoin(installations, eq(installations.id, memberInstallations.installationId))
    .where(eq(memberInstallations.memberId, memberId))
    .orderBy(installations.id);
}
