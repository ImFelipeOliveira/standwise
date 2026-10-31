import { describe, expect, test } from 'bun:test';
import {
  getConnection,
  getIdentities,
  saveConnection,
  setIdentity,
  setMemberInstallations,
  upsertMember,
} from '@standwise/db';
import { db, useCleanDb } from '../../db/test/setup';
import {
  LINK_TRACKER_IDENTITIES_JOB,
  linkTrackerIdentities,
  linkTrackerIdentity,
  loginForLinearUser,
  startSession,
} from '../src';
import { config, fakeDeps, INST, seedMember, seedOrg } from './use-cases/fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);

async function connect(inst = INST) {
  await saveConnection(
    db,
    inst,
    'linear',
    'org-1',
    JSON.stringify({ accessToken: 'lin_at_1', refreshToken: null, expiresAt: null }),
    KEY,
    'Acme',
    'acme',
  );
}

const overrides = (body: string) => `members:\n${body}`;

describe('linking at login', () => {
  test('links by the github email', async () => {
    await seedOrg();
    await connect();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    await startSession(deps, { githubToken: 'gho_x' });
    expect((await getIdentities(db, INST, 'linear')).get('alice')).toBe('lin-alice');
  });

  test('the config override wins over the github email', async () => {
    await seedOrg(config('[alice, bob]', overrides('  alice:\n    linear: other@acme.com')));
    await connect();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-wrong');
    linear.state.users.set('other@acme.com', 'lin-right');
    await startSession(deps, { githubToken: 'gho_x' });
    expect((await getIdentities(db, INST, 'linear')).get('alice')).toBe('lin-right');
    expect(linear.calls.userLookups).toEqual(['other@acme.com']);
  });

  test('no linear user removes a stale identity', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-old');
    const { deps } = fakeDeps();
    await linkTrackerIdentity(deps, INST, member.id, 'alice@acme.com');
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('a linear failure does not fail login', async () => {
    await seedOrg();
    await connect();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 500;
    const result = await startSession(deps, { githubToken: 'gho_x' });
    expect(result.orgs).toHaveLength(1);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('an auth failure invalidates the connection and does not fail login', async () => {
    await seedOrg();
    await connect();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 401;
    await startSession(deps, { githubToken: 'gho_x' });
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeTruthy();
  });

  test('does nothing without a connection or an operational config', async () => {
    await seedOrg();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    await startSession(deps, { githubToken: 'gho_x' });
    expect(linear.calls.userLookups).toEqual([]);
    await seedOrg(null);
    await connect();
    await startSession(deps, { githubToken: 'gho_x' });
    expect(linear.calls.userLookups).toEqual([]);
  });

  test('does nothing without any email', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    const { deps, linear } = fakeDeps();
    await linkTrackerIdentity(deps, INST, member.id, null);
    expect(linear.calls.userLookups).toEqual([]);
  });
});

describe('linkTrackerIdentities', () => {
  async function seedTeam() {
    await seedOrg();
    await connect();
    const alice = await seedMember();
    const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: 'bob@acme.com' });
    const eve = await upsertMember(db, { githubUserId: 3, login: 'eve', email: 'eve@acme.com' });
    for (const m of [alice, bob, eve]) await setMemberInstallations(db, m.id, [INST]);
  }

  test('links every configured member and skips people outside the config', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    linear.state.users.set('bob@acme.com', 'lin-bob');
    linear.state.users.set('eve@acme.com', 'lin-eve');
    await linkTrackerIdentities(deps, INST);
    const ids = await getIdentities(db, INST, 'linear');
    expect(Object.fromEntries(ids)).toEqual({ alice: 'lin-alice', bob: 'lin-bob' });
  });

  test('stops without throwing on a rate limit', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 429;
    await linkTrackerIdentities(deps, INST);
    expect(linear.calls.userLookups).toEqual([]);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('stops and invalidates on an auth error', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 401;
    await linkTrackerIdentities(deps, INST);
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeTruthy();
    expect(linear.calls.bearer).toHaveLength(1);
  });

  test('does nothing when the installation has no config or no connection', async () => {
    await seedOrg();
    const { deps, linear } = fakeDeps();
    await linkTrackerIdentities(deps, INST);
    expect(linear.calls.bearer).toEqual([]);
  });
});

describe('loginForLinearUser', () => {
  test('resolves by config override, case-insensitive', async () => {
    await seedOrg();
    const cfg = config('[alice, bob]', overrides('  bob:\n    linear: Bob@Acme.com'));
    const { deps } = fakeDeps();
    expect(await loginForLinearUser(deps, INST, cfg, { id: 'x', email: 'bob@acme.com' })).toBe(
      'bob',
    );
  });

  test('resolves by stored identity', async () => {
    await seedOrg();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-alice');
    const { deps } = fakeDeps();
    expect(await loginForLinearUser(deps, INST, config(), { id: 'lin-alice', email: null })).toBe(
      'Alice',
    );
  });

  test('returns null for an unknown user', async () => {
    await seedOrg();
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, config(), { id: 'nope', email: 'z@acme.com' }),
    ).toBeNull();
  });

  test('returns null for a login outside the config', async () => {
    await seedOrg();
    const member = await seedMember('zed', 9);
    await setMemberInstallations(db, member.id, [INST]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-zed');
    const cfg = config('[alice]', overrides('  zed:\n    linear: zed@acme.com'));
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, cfg, { id: 'lin-zed', email: 'zed@acme.com' }),
    ).toBeNull();
  });

  test('returns null when two overrides share an email', async () => {
    await seedOrg();
    const cfg = config(
      '[alice, bob]',
      overrides('  alice:\n    linear: same@acme.com\n  bob:\n    linear: SAME@acme.com'),
    );
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, cfg, { id: 'x', email: 'same@acme.com' }),
    ).toBeNull();
  });

  test('never uses an identity of another installation', async () => {
    await seedOrg();
    await seedOrg(config(), { id: 12, accountLogin: 'other' });
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST, 12]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-alice');
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, 12, config(), { id: 'lin-alice', email: null }),
    ).toBeNull();
    expect(await loginForLinearUser(deps, INST, config(), { id: 'lin-alice', email: null })).toBe(
      'Alice',
    );
  });

  test('job name is stable', () => {
    expect(LINK_TRACKER_IDENTITIES_JOB).toBe('link-tracker-identities');
  });
});
