import { and, eq, inArray, ne, sql } from 'drizzle-orm';
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

export async function updateMemberLogin(
  db: Db,
  githubUserId: number,
  login: string,
): Promise<MemberRow | null> {
  return db.transaction(async (tx) => {
    await tx
      .update(members)
      .set({ login: sql`'~' || ${members.githubUserId}` })
      .where(
        and(sql`lower(${members.login}) = lower(${login})`, ne(members.githubUserId, githubUserId)),
      );
    const [row] = await tx
      .update(members)
      .set({ login })
      .where(eq(members.githubUserId, githubUserId))
      .returning();
    return row ?? null;
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

export async function addMemberInstallation(
  db: Db,
  memberId: string,
  installationId: number,
): Promise<void> {
  await db.insert(memberInstallations).values({ memberId, installationId }).onConflictDoNothing();
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

export async function deleteIdentities(
  db: Db,
  installationId: number,
  provider: Provider,
): Promise<void> {
  await db
    .delete(memberIdentities)
    .where(
      and(
        eq(memberIdentities.installationId, installationId),
        eq(memberIdentities.provider, provider),
      ),
    );
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

export async function getMemberLogins(db: Db, logins: string[]): Promise<Map<string, string>> {
  if (logins.length === 0) return new Map();
  const lowered = logins.map((l) => l.toLowerCase());
  const rows = await db
    .select({ login: members.login })
    .from(members)
    .where(inArray(sql`lower(${members.login})`, lowered));
  return new Map(rows.map((r) => [r.login.toLowerCase(), r.login]));
}

export async function getInstallationMemberIds(
  db: Db,
  installationId: number,
  logins: string[],
): Promise<Map<string, string>> {
  if (logins.length === 0) return new Map();
  const lowered = [...new Set(logins.map((l) => l.toLowerCase()))];
  const rows = await db
    .select({ id: members.id, login: members.login })
    .from(members)
    .innerJoin(memberInstallations, eq(memberInstallations.memberId, members.id))
    .where(
      and(
        eq(memberInstallations.installationId, installationId),
        inArray(sql`lower(${members.login})`, lowered),
      ),
    );
  return new Map(rows.map((r) => [r.login.toLowerCase(), r.id]));
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

export async function removeMemberInstallation(
  db: Db,
  memberId: string,
  installationId: number,
): Promise<void> {
  await db
    .delete(memberInstallations)
    .where(
      and(
        eq(memberInstallations.memberId, memberId),
        eq(memberInstallations.installationId, installationId),
      ),
    );
}

export async function findMemberByIdentity(
  db: Db,
  installationId: number,
  provider: Provider,
  externalId: string,
): Promise<MemberRow | null> {
  const [row] = await db
    .select({ member: members })
    .from(memberIdentities)
    .innerJoin(members, eq(members.id, memberIdentities.memberId))
    .where(
      and(
        eq(memberIdentities.installationId, installationId),
        eq(memberIdentities.provider, provider),
        eq(memberIdentities.externalId, externalId),
      ),
    );
  return row?.member ?? null;
}

export async function deleteIdentity(
  db: Db,
  installationId: number,
  memberId: string,
  provider: Provider,
): Promise<void> {
  await db
    .delete(memberIdentities)
    .where(
      and(
        eq(memberIdentities.installationId, installationId),
        eq(memberIdentities.memberId, memberId),
        eq(memberIdentities.provider, provider),
      ),
    );
}

export async function listInstallationMembers(
  db: Db,
  installationId: number,
): Promise<{ id: string; login: string; email: string | null }[]> {
  return db
    .select({ id: members.id, login: members.login, email: members.email })
    .from(memberInstallations)
    .innerJoin(members, eq(members.id, memberInstallations.memberId))
    .where(eq(memberInstallations.installationId, installationId))
    .orderBy(members.login);
}
