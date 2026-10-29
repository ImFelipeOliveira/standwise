import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  createApiKey,
  listApiKeys,
  resolveApiKey,
  revokeApiKey,
  upsertInstallation,
  upsertMember,
} from '../src';
import { db, useCleanDb } from './setup';

useCleanDb();

async function seed() {
  await upsertInstallation(db, { id: 11, accountLogin: 'acme', accountType: 'Organization' });
  await upsertInstallation(db, { id: 12, accountLogin: 'other', accountType: 'Organization' });
  const member = await upsertMember(db, { githubUserId: 1, login: 'alice', email: null });
  return member;
}

async function rows() {
  return db.execute(sql`SELECT * FROM api_keys`) as unknown as Record<string, unknown>[];
}

describe('api keys repo', () => {
  test('key stored as hash', async () => {
    const member = await seed();
    const { id, key } = await createApiKey(db, {
      installationId: 11,
      name: 'ci',
      scopes: ['teams:read', 'dailies:read'],
      createdBy: member.id,
    });
    expect(key).toMatch(/^swk_[A-Za-z0-9_-]{43}$/);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(JSON.stringify(stored)).not.toContain(key.slice(4));
    expect(stored[0]?.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]?.prefix).toBe(key.slice(4, 12));
    expect(await resolveApiKey(db, key)).toEqual({
      id,
      installationId: 11,
      scopes: ['teams:read', 'dailies:read'],
    });
  });

  test('unknown, malformed and revoked keys do not resolve', async () => {
    const member = await seed();
    const { id, key } = await createApiKey(db, {
      installationId: 11,
      name: 'ci',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    expect(await resolveApiKey(db, 'swk_nope')).toBeNull();
    expect(await resolveApiKey(db, '')).toBeNull();
    expect(await resolveApiKey(db, key.replace('swk_', 'sw_'))).toBeNull();
    expect(await revokeApiKey(db, 11, id)).toBe(true);
    expect(await resolveApiKey(db, key)).toBeNull();
  });

  test('revoke is scoped to the installation and is not repeatable', async () => {
    const member = await seed();
    const { id, key } = await createApiKey(db, {
      installationId: 11,
      name: 'ci',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    expect(await revokeApiKey(db, 12, id)).toBe(false);
    expect(await resolveApiKey(db, key)).not.toBeNull();
    expect(await revokeApiKey(db, 11, id)).toBe(true);
    expect(await revokeApiKey(db, 11, id)).toBe(false);
  });

  test('last_used_at is written at most once per minute', async () => {
    const member = await seed();
    const { id, key } = await createApiKey(db, {
      installationId: 11,
      name: 'ci',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    const lastUsed = async () => (await listApiKeys(db, 11)).find((k) => k.id === id)?.lastUsedAt;
    expect(await lastUsed()).toBeNull();
    await resolveApiKey(db, key);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await Bun.sleep(20);
    await resolveApiKey(db, key);
    expect((await lastUsed())?.getTime()).toBe(first?.getTime());
    await db.execute(
      sql`UPDATE api_keys SET last_used_at = now() - interval '2 minutes' WHERE id = ${id}`,
    );
    await resolveApiKey(db, key);
    const third = await lastUsed();
    expect(third?.getTime()).toBeGreaterThan(first?.getTime() ?? 0);
  });

  test('list is scoped to the installation and never exposes the secret', async () => {
    const member = await seed();
    const mine = await createApiKey(db, {
      installationId: 11,
      name: 'mine',
      scopes: ['blockers:read'],
      createdBy: member.id,
    });
    await createApiKey(db, {
      installationId: 12,
      name: 'theirs',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    const list = await listApiKeys(db, 11);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: mine.id,
      name: 'mine',
      prefix: mine.key.slice(4, 12),
      scopes: ['blockers:read'],
      createdAt: expect.any(Date),
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  test('deleting the installation removes its keys', async () => {
    const member = await seed();
    const { key } = await createApiKey(db, {
      installationId: 11,
      name: 'ci',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    await db.execute(sql`DELETE FROM installations WHERE id = 11`);
    expect(await resolveApiKey(db, key)).toBeNull();
    expect(await rows()).toHaveLength(0);
  });
});
