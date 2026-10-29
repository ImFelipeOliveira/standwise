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
    expect(r.filter((x) => x === 'claimed')).toHaveLength(1);
    expect(r.filter((x) => x === 'in_progress')).toHaveLength(1);
  });

  test('claimDelivery after sent', async () => {
    await seed();
    expect(await claimDelivery(db, dkey)).toBe('claimed');
    await completeDelivery(db, dkey, { channel: 'C1', id: '1.2' });
    expect(await claimDelivery(db, dkey)).toBe('already_sent');
    expect((await getDelivery(db, dkey))?.ref).toEqual({ channel: 'C1', id: '1.2' });
  });

  test('claimDelivery retries failed up to 3', async () => {
    await seed();
    for (let i = 0; i < 3; i++) {
      expect(await claimDelivery(db, dkey)).toBe('claimed');
      await failDelivery(db, dkey, 'boom');
    }
    expect(await claimDelivery(db, dkey)).toBe('already_sent');
    const row = await getDelivery(db, dkey);
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(3);
    expect(row?.error).toBe('boom');
    expect(await listFailedDeliveries(db, INST, 10)).toHaveLength(1);
  });

  test('claimDelivery reopens a stale pending row', async () => {
    await seed();
    expect(await claimDelivery(db, dkey)).toBe('claimed');
    expect(await claimDelivery(db, dkey)).toBe('in_progress');
    await db.execute(sql`UPDATE deliveries SET updated_at = now() - interval '11 minutes'`);
    expect(await claimDelivery(db, dkey)).toBe('claimed');
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
