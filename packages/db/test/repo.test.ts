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
  getInstallationMemberIds,
  getLastDaily,
  listDailies,
  listFailedPersonDeliveryGroups,
  listFailedTeamDeliveries,
  listOperationalInstallations,
  listPersonDeliveries,
  markConnectionInvalid,
  markDeliverySent,
  resolveSession,
  revokeSession,
  rotateConnectionSecret,
  saveConnection,
  setIdentity,
  setInstallationConfig,
  setMemberInstallations,
  updateMemberLogin,
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

  test('claimDelivery accepts person-level kinds with empty team', async () => {
    await seed();
    for (const kind of ['reminder', 'blocker_route', 'suggestion_dm'] as const) {
      const k = { ...dkey, teamName: '', kind, subject: 'ana' };
      expect(await claimDelivery(db, k)).toEqual({ status: 'claimed', token: 1 });
      expect(await claimDelivery(db, k)).toEqual({ status: 'in_progress' });
    }
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
    expect(await listFailedTeamDeliveries(db, INST, 10)).toHaveLength(1);
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

describe('delivery markers', () => {
  test('markDeliverySent records a sent row and is idempotent', async () => {
    await upsertInstallation(db, { id: 1, accountLogin: 'acme', accountType: 'Organization' });
    const key = {
      installationId: 1,
      teamName: '',
      date: '2026-10-28',
      kind: 'signal_scan' as const,
      subject: 'alice',
    };
    await markDeliverySent(db, key);
    await markDeliverySent(db, key);
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('sent');
    expect(row?.attempts).toBe(1);
    expect(await claimDelivery(db, key)).toEqual({ status: 'already_sent' });
  });
});

describe('admin-visible failed deliveries', () => {
  async function fail(k: Parameters<typeof claimDelivery>[1], error: string) {
    const claim = await claimDelivery(db, k);
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await failDelivery(db, k, claim.token, error);
  }

  test('team failures list digest and late_daily only, latest first, capped', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    for (let day = 1; day <= 6; day++) {
      await fail({ ...dkey, date: `2026-10-0${day}` }, 'not_in_channel: x');
      await db.execute(
        sql`UPDATE deliveries SET updated_at = now() - make_interval(days => ${10 - day})
          WHERE date = ${`2026-10-0${day}`}`,
      );
    }
    await fail({ ...dkey, kind: 'late_daily', subject: 'm1' }, 'internal_error: unexpected error');
    await fail({ ...dkey, kind: 'reminder', subject: 'ana' }, 'no_chat_identity: ana');
    const listed = await listFailedTeamDeliveries(db, INST, 5);
    expect(listed.map((d) => [d.kind, d.date])).toEqual([
      ['late_daily', '2026-10-27'],
      ['digest', '2026-10-06'],
      ['digest', '2026-10-05'],
      ['digest', '2026-10-04'],
      ['digest', '2026-10-03'],
    ]);
  });

  test('person failures are grouped by kind and error and never include hidden kinds', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    await upsertInstallation(db, { id: 2, accountLogin: 'other', accountType: 'Organization' });
    const base = { installationId: INST, teamName: '', date: '2026-10-28' };
    for (const kind of ['suggestion_dm', 'signal_scan'] as const) {
      await fail({ ...base, kind, subject: `${kind}-subject` }, 'no_chat_identity');
    }
    await markDeliverySent(db, { ...base, kind: 'signal_scan', subject: 'alice' });
    await fail({ ...base, kind: 'reminder', subject: 'ana' }, 'no_chat_identity: ana');
    await fail(
      { ...base, date: '2026-10-29', kind: 'reminder', subject: 'ana' },
      'no_chat_identity: ana',
    );
    await fail({ ...base, kind: 'blocker_route', subject: 'd1:h1:mgr' }, 'no_chat_identity: mgr');
    await fail({ ...base, kind: 'blocker_route', subject: 'd1:h2:mgr' }, 'no_chat_identity: mgr');
    await fail({ ...base, kind: 'blocker_route', subject: 'd1:h3:-' }, 'no_route_target');
    await fail(
      { ...base, installationId: 2, kind: 'reminder', subject: 'x' },
      'no_chat_connection',
    );
    const groups = await listFailedPersonDeliveryGroups(db, INST, 10);
    expect(groups.map((g) => [g.kind, g.error, g.count, g.lastAt instanceof Date]).sort()).toEqual([
      ['blocker_route', 'no_chat_identity: mgr', 2, true],
      ['blocker_route', 'no_route_target', 1, true],
      ['reminder', 'no_chat_identity: ana', 2, true],
    ]);
    expect(JSON.stringify(groups)).not.toContain('d1:');
    expect(await listFailedPersonDeliveryGroups(db, INST, 2)).toHaveLength(2);
  });
});

describe('person deliveries', () => {
  test('listPersonDeliveries returns one kind for one installation and date', async () => {
    await upsertInstallation(db, { id: 1, accountLogin: 'acme', accountType: 'Organization' });
    await upsertInstallation(db, { id: 2, accountLogin: 'other', accountType: 'Organization' });
    const k = (
      installationId: number,
      date: string,
      kind: 'signal_scan' | 'reminder',
      subject: string,
    ) => ({ installationId, teamName: '', date, kind, subject }) as const;
    await markDeliverySent(db, k(1, '2026-10-28', 'signal_scan', 'alice'));
    await markDeliverySent(db, k(1, '2026-10-28', 'signal_scan', 'bob'));
    await markDeliverySent(db, k(1, '2026-10-27', 'signal_scan', 'carol'));
    await markDeliverySent(db, k(2, '2026-10-28', 'signal_scan', 'dave'));
    await markDeliverySent(db, k(1, '2026-10-28', 'reminder', 'erin'));
    const rows = await listPersonDeliveries(db, 1, '2026-10-28', 'signal_scan');
    expect(rows.map((r) => r.subject).sort()).toEqual(['alice', 'bob']);
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
    expect(await listOperationalInstallations(db)).toEqual([
      { id: INST, accountLogin: 'acme', config },
    ]);
  });

  test('removing the file drops the config so a later invalid push has nothing in use', async () => {
    await seed();
    const config = { teams: [], members: {} };
    const errors = [{ path: 'teams', message: 'bad' }];
    await setInstallationConfig(db, INST, { status: 'configured', config });
    await setInstallationConfig(db, INST, { status: 'unconfigured', reason: 'no_file' });
    const removed = await getInstallation(db, INST);
    expect(removed?.config).toBeNull();
    expect(removed?.configErrors).toBeNull();
    await setInstallationConfig(db, INST, { status: 'invalid', errors });
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('invalid');
    expect(row?.config).toBeNull();
    expect(await listOperationalInstallations(db)).toEqual([]);
  });

  test('listOperationalInstallations returns configured installations', async () => {
    await seed();
    const config = { teams: [], members: {} };
    await setInstallationConfig(db, INST, { status: 'configured', config });
    expect(await listOperationalInstallations(db)).toEqual([
      { id: INST, accountLogin: 'acme', config },
    ]);
  });

  test('listOperationalInstallations skips invalid without a valid config and unconfigured', async () => {
    await seed();
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    expect(await listOperationalInstallations(db)).toEqual([]);
    await setInstallationConfig(db, INST, { status: 'unconfigured', reason: 'no_file' });
    expect(await listOperationalInstallations(db)).toEqual([]);
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
    expect(rows[0]?.login).toBe('~1');
  });

  test('updateMemberLogin keeps email and tombstones the other holder', async () => {
    const a = await upsertMember(db, { githubUserId: 1, login: 'alice-new', email: 'a@x.com' });
    const b = await upsertMember(db, { githubUserId: 2, login: 'alice', email: 'b@x.com' });
    const renamed = await updateMemberLogin(db, 2, 'Alice-New');
    expect(renamed?.id).toBe(b.id);
    expect(renamed?.login).toBe('Alice-New');
    expect(renamed?.email).toBe('b@x.com');
    const rows = await db.execute(sql`SELECT login, email FROM members WHERE id = ${a.id}`);
    expect(rows[0]?.login).toBe('~1');
    expect(rows[0]?.email).toBe('a@x.com');
  });

  test('updateMemberLogin returns null for an unknown github id', async () => {
    expect(await updateMemberLogin(db, 99, 'nobody')).toBeNull();
  });
});

describe('installation member ids', () => {
  test('returns ids only for members linked to the installation, case-insensitively', async () => {
    await upsertInstallation(db, { id: 1, accountLogin: 'acme', accountType: 'Organization' });
    await upsertInstallation(db, { id: 2, accountLogin: 'other', accountType: 'Organization' });
    const ana = await upsertMember(db, { githubUserId: 1, login: 'Ana', email: null });
    const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: null });
    await upsertMember(db, { githubUserId: 3, login: 'carol', email: null });
    await setMemberInstallations(db, ana.id, [1]);
    await setMemberInstallations(db, bob.id, [2]);
    const ids = await getInstallationMemberIds(db, 1, ['ANA', 'bob', 'carol', 'dave']);
    expect([...ids.entries()]).toEqual([['ana', ana.id]]);
    expect((await getInstallationMemberIds(db, 2, ['Bob'])).get('bob')).toBe(bob.id);
    expect((await getInstallationMemberIds(db, 1, [])).size).toBe(0);
  });
});

describe('member login placeholders', () => {
  test('a real user named ghost-<id> cannot collide with a released login', async () => {
    const a = await upsertMember(db, { githubUserId: 123, login: 'ghost-123', email: null });
    const b = await upsertMember(db, { githubUserId: 456, login: 'ghost-123', email: null });
    expect(b.login).toBe('ghost-123');
    const rows = await db.execute(sql`SELECT login FROM members WHERE id = ${a.id}`);
    expect(rows[0]?.login).toBe('~123');
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
    await saveConnection(db, INST, 'slack', 'T1', 'xoxb-secret', key, 'Acme');
    const rows = await db.execute(sql`SELECT secret_ciphertext FROM connections`);
    expect(rows[0]?.secret_ciphertext).not.toBe('xoxb-secret');
    expect(await getConnection(db, INST, 'slack', key)).toEqual({
      externalId: 'T1',
      externalName: 'Acme',
      externalKey: null,
      secret: 'xoxb-secret',
      invalidatedAt: null,
    });
  });

  test('stores the external key next to the name', async () => {
    await seed();
    await saveConnection(db, INST, 'linear', 'org-1', '{}', key, 'Acme Inc', 'acme');
    expect(await getConnection(db, INST, 'linear', key)).toMatchObject({
      externalId: 'org-1',
      externalName: 'Acme Inc',
      externalKey: 'acme',
    });
  });

  test('marking a connection invalid keeps it and saving again clears the mark', async () => {
    await seed();
    await saveConnection(db, INST, 'linear', 'org-1', 'tok', key, 'Acme', 'acme');
    await saveConnection(db, INST, 'slack', 'T1', 'xoxb', key, 'Acme');
    await markConnectionInvalid(db, INST, 'linear');
    expect((await getConnection(db, INST, 'linear', key))?.invalidatedAt).toBeInstanceOf(Date);
    expect((await getConnection(db, INST, 'slack', key))?.invalidatedAt).toBeNull();
    await saveConnection(db, INST, 'linear', 'org-1', 'tok2', key, 'Acme', 'acme');
    expect((await getConnection(db, INST, 'linear', key))?.invalidatedAt).toBeNull();
  });

  test('rotating a secret stores the new value encrypted', async () => {
    await seed();
    await saveConnection(db, INST, 'linear', 'org-1', 'old', key, 'Acme', 'acme');
    const seen: string[] = [];
    const result = await rotateConnectionSecret(db, INST, 'linear', key, async (current) => {
      seen.push(current);
      return 'new';
    });
    expect(seen).toEqual(['old']);
    expect(result).toBe('new');
    expect((await getConnection(db, INST, 'linear', key))?.secret).toBe('new');
    const rows = await db.execute(sql`SELECT secret_ciphertext FROM connections`);
    expect(rows[0]?.secret_ciphertext).not.toBe('new');
  });

  test('rotating keeps the current secret when the callback skips', async () => {
    await seed();
    await saveConnection(db, INST, 'linear', 'org-1', 'old', key, 'Acme', 'acme');
    expect(await rotateConnectionSecret(db, INST, 'linear', key, async () => null)).toBe('old');
    expect((await getConnection(db, INST, 'linear', key))?.secret).toBe('old');
  });

  test('rotating returns null for a missing or invalid connection', async () => {
    await seed();
    const rotate = async () => 'new';
    expect(await rotateConnectionSecret(db, INST, 'linear', key, rotate)).toBeNull();
    await saveConnection(db, INST, 'linear', 'org-1', 'old', key, 'Acme', 'acme');
    await markConnectionInvalid(db, INST, 'linear');
    expect(await rotateConnectionSecret(db, INST, 'linear', key, rotate)).toBeNull();
    expect((await getConnection(db, INST, 'linear', key))?.secret).toBe('old');
  });

  test('concurrent rotations run one after the other and see the latest secret', async () => {
    await seed();
    await saveConnection(db, INST, 'linear', 'org-1', 'v0', key, 'Acme', 'acme');
    const seen: string[] = [];
    const bump = async (current: string) => {
      seen.push(current);
      await Bun.sleep(20);
      return current === 'v0' ? 'v1' : null;
    };
    const results = await Promise.all([
      rotateConnectionSecret(db, INST, 'linear', key, bump),
      rotateConnectionSecret(db, INST, 'linear', key, bump),
    ]);
    expect(seen).toEqual(['v0', 'v1']);
    expect(results).toEqual(['v1', 'v1']);
  });
});
