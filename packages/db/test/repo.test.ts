import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { DailySubmission } from '@standwise/core';
import { sql } from 'drizzle-orm';
import {
  claimDelivery,
  completeDelivery,
  createSession,
  deleteInstallation,
  failDelivery,
  getConnection,
  getDelivery,
  getIdentities,
  getInstallation,
  getLastDaily,
  listConfiguredInstallations,
  listDailies,
  listFailedDeliveries,
  resolveSession,
  revokeSession,
  saveConnection,
  setIdentity,
  setInstallationConfig,
  setMemberInstallations,
  upsertDaily,
  upsertInstallation,
  upsertMember,
} from '../src';
import { db, useCleanDb } from './setup';

useCleanDb();

const INST = 100;
const key = randomBytes(32);
const daily = (text: string) => ({ text }) as unknown as DailySubmission;
const backdateDeliveries = () =>
  db.execute(sql`UPDATE deliveries SET updated_at = now() - interval '11 minutes'`);
const dkey = {
  installationId: INST,
  teamName: 'core',
  date: '2026-10-27',
  kind: 'digest',
} as const;

async function seed() {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  return upsertMember(db, { githubUserId: 1, login: 'Ana', email: 'ana@acme.io' });
}

describe('dailies', () => {
  test('upsertDaily replaces same day', async () => {
    const m = await seed();
    const base = { installationId: INST, memberId: m.id, date: '2026-10-27' };
    await upsertDaily(db, {
      ...base,
      payload: daily('one'),
      submittedAt: new Date('2026-10-27T10:00:00Z'),
    });
    await upsertDaily(db, {
      ...base,
      payload: daily('two'),
      submittedAt: new Date('2026-10-27T11:00:00Z'),
    });
    const rows = await listDailies(db, INST, '2026-10-27');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual(daily('two'));
    expect(rows[0]?.login).toBe('Ana');
  });

  test('getLastDaily returns most recent strictly before', async () => {
    const m = await seed();
    for (const date of ['2026-10-22', '2026-10-26', '2026-10-27']) {
      await upsertDaily(db, {
        installationId: INST,
        memberId: m.id,
        date,
        payload: daily(date),
        submittedAt: new Date(`${date}T10:00:00Z`),
      });
    }
    expect((await getLastDaily(db, INST, m.id, '2026-10-27'))?.date).toBe('2026-10-26');
    expect(await getLastDaily(db, INST, m.id, '2026-10-22')).toBeNull();
  });
});

describe('deliveries', () => {
  test('claimDelivery is exclusive', async () => {
    await seed();
    const r = await Promise.all([claimDelivery(db, dkey), claimDelivery(db, dkey)]);
    expect(r.filter((x) => x.status === 'claimed')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'in_progress')).toHaveLength(1);
  });

  test('claimDelivery after sent', async () => {
    await seed();
    const c = await claimDelivery(db, dkey);
    expect(c).toEqual({ status: 'claimed', token: 1 });
    expect(await completeDelivery(db, dkey, 1, { channel: 'C1', id: '1.2' })).toBe(true);
    expect(await claimDelivery(db, dkey)).toEqual({ status: 'already_sent' });
    expect((await getDelivery(db, dkey))?.ref).toEqual({ channel: 'C1', id: '1.2' });
  });

  test('claimDelivery retries failed up to 3', async () => {
    await seed();
    for (let i = 0; i < 3; i++) {
      expect(await claimDelivery(db, dkey)).toEqual({ status: 'claimed', token: i + 1 });
      expect(await failDelivery(db, dkey, i + 1, 'boom')).toBe(true);
    }
    expect(await claimDelivery(db, dkey)).toEqual({ status: 'already_sent' });
    const row = await getDelivery(db, dkey);
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(3);
    expect(row?.error).toBe('boom');
    expect(await listFailedDeliveries(db, INST, 10)).toHaveLength(1);
  });

  test('claimDelivery reopens a stale pending row', async () => {
    await seed();
    expect((await claimDelivery(db, dkey)).status).toBe('claimed');
    expect(await claimDelivery(db, dkey)).toEqual({ status: 'in_progress' });
    await backdateDeliveries();
    expect(await claimDelivery(db, dkey)).toEqual({ status: 'claimed', token: 2 });
  });

  test('stale pending is capped at 3 attempts and ends failed', async () => {
    await seed();
    for (let i = 1; i <= 3; i++) {
      expect(await claimDelivery(db, dkey)).toEqual({ status: 'claimed', token: i });
      await backdateDeliveries();
    }
    expect(await claimDelivery(db, dkey)).toEqual({ status: 'already_sent' });
    const row = await getDelivery(db, dkey);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('worker_died: no completion after 3 attempts');
  });

  test('a stalled worker cannot overwrite a delivery completed by its successor', async () => {
    await seed();
    const a = await claimDelivery(db, dkey);
    await backdateDeliveries();
    const b = await claimDelivery(db, dkey);
    expect(a).toEqual({ status: 'claimed', token: 1 });
    expect(b).toEqual({ status: 'claimed', token: 2 });
    expect(await completeDelivery(db, dkey, 2, { channel: 'C1', id: '1.2' })).toBe(true);
    expect(await failDelivery(db, dkey, 1, 'late')).toBe(false);
    expect(await completeDelivery(db, dkey, 1, { channel: 'C9', id: '9' })).toBe(false);
    const row = await getDelivery(db, dkey);
    expect(row?.status).toBe('sent');
    expect(row?.ref).toEqual({ channel: 'C1', id: '1.2' });
  });
});

describe('installations', () => {
  test('invalid config keeps last valid', async () => {
    await seed();
    const config = { teams: [], members: {} };
    const errors = [{ path: 'teams', message: 'bad' }];
    await setInstallationConfig(db, INST, { status: 'configured', config });
    await setInstallationConfig(db, INST, { status: 'invalid', errors });
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('invalid');
    expect(row?.config).toEqual(config);
    expect(row?.configErrors).toEqual(errors);
    expect(await listConfiguredInstallations(db)).toEqual([]);
  });

  test('listConfiguredInstallations returns configured only', async () => {
    await seed();
    const config = { teams: [], members: {} };
    await setInstallationConfig(db, INST, { status: 'configured', config });
    expect(await listConfiguredInstallations(db)).toEqual([
      { id: INST, accountLogin: 'acme', config },
    ]);
  });

  test('deleteInstallation cascades', async () => {
    const m = await seed();
    await upsertDaily(db, {
      installationId: INST,
      memberId: m.id,
      date: '2026-10-27',
      payload: daily('x'),
      submittedAt: new Date(),
    });
    await claimDelivery(db, dkey);
    await saveConnection(db, INST, 'slack', 'T1', 'tok', key);
    await deleteInstallation(db, INST);
    expect(await listDailies(db, INST, '2026-10-27')).toEqual([]);
    expect(await getDelivery(db, dkey)).toBeNull();
    expect(await getConnection(db, INST, 'slack', key)).toBeNull();
  });
});

describe('members and identities', () => {
  test('setMemberInstallations replaces the set; identities keyed by lowercase login', async () => {
    const m = await seed();
    await upsertInstallation(db, { id: 200, accountLogin: 'other', accountType: 'User' });
    await setMemberInstallations(db, m.id, [INST, 200]);
    await setMemberInstallations(db, m.id, [200]);
    await setIdentity(db, INST, m.id, 'slack', 'U1');
    await setIdentity(db, INST, m.id, 'slack', 'U2');
    expect((await getIdentities(db, INST, 'slack')).get('ana')).toBe('U2');
    expect((await getIdentities(db, 200, 'slack')).size).toBe(0);
  });
});

describe('member logins', () => {
  test('upsertMember releases a login taken over case-insensitively', async () => {
    const a = await upsertMember(db, { githubUserId: 1, login: 'bob', email: null });
    const b = await upsertMember(db, { githubUserId: 2, login: 'Bob', email: null });
    expect(b.login).toBe('Bob');
    const rows = await db.execute(sql`SELECT login FROM members WHERE id = ${a.id}`);
    expect(rows[0]?.login).toBe('ghost-1');
  });
});

describe('sessions', () => {
  test('sessions store only hashes', async () => {
    const m = await seed();
    const token = await createSession(db, m.id, 'cli');
    expect(token).toMatch(/^sw_[A-Za-z0-9_-]{43}$/);
    const rows = await db.execute(sql`SELECT * FROM sessions`);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await resolveSession(db, token, 'cli'))?.id).toBe(m.id);
    expect(await resolveSession(db, token, 'web')).toBeNull();
    expect(await resolveSession(db, 'sw_nope', 'cli')).toBeNull();
  });

  test('web session expires 7 days after creation', async () => {
    const m = await seed();
    const token = await createSession(db, m.id, 'web');
    await db.execute(sql`UPDATE sessions SET created_at = now() - interval '8 days'`);
    expect(await resolveSession(db, token, 'web')).toBeNull();
  });

  test('cli session expires after 90 idle days, but use keeps it alive', async () => {
    const m = await seed();
    const idle = await createSession(db, m.id, 'cli');
    await db.execute(sql`UPDATE sessions SET last_used_at = now() - interval '91 days'`);
    expect(await resolveSession(db, idle, 'cli')).toBeNull();
    const active = await createSession(db, m.id, 'cli');
    await db.execute(
      sql`UPDATE sessions SET created_at = now() - interval '200 days', last_used_at = now() - interval '30 days'`,
    );
    expect((await resolveSession(db, active, 'cli'))?.id).toBe(m.id);
  });

  test('revoked session resolves to null', async () => {
    const m = await seed();
    const token = await createSession(db, m.id, 'cli');
    await revokeSession(db, token);
    expect(await resolveSession(db, token, 'cli')).toBeNull();
  });
});

describe('connections', () => {
  test('connection secret encrypted', async () => {
    await seed();
    await saveConnection(db, INST, 'slack', 'T1', 'xoxb-secret', key);
    const rows = await db.execute(sql`SELECT secret_ciphertext FROM connections`);
    expect(rows[0]?.secret_ciphertext).not.toBe('xoxb-secret');
    expect(await getConnection(db, INST, 'slack', key)).toEqual({
      externalId: 'T1',
      secret: 'xoxb-secret',
    });
  });
});
