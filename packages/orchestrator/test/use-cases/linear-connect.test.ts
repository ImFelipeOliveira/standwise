import { describe, expect, test } from 'bun:test';
import {
  getConnection,
  getIdentities,
  markConnectionInvalid,
  saveConnection,
  setIdentity,
  setMemberInstallations,
  upsertInstallation,
} from '@standwise/db';
import { LinearAuthError } from '@standwise/linear';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  completeLinearConnect,
  createMembershipCheck,
  type DomainError,
  hashSessionToken,
  signState,
  startLinearConnect,
  startSlackConnect,
} from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);
const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';
const codeOf = async (run: Promise<unknown>) =>
  ((await run.catch((e: unknown) => e)) as DomainError).code;

async function setup() {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const harness = fakeDeps();
  harness.roles.set('alice', { role: 'admin', state: 'active' });
  return { ...harness, member, isMember: createMembershipCheck(harness.deps) };
}

async function connect(h: Awaited<ReturnType<typeof setup>>, sessionToken = 'tok') {
  const { url } = await startLinearConnect(h.deps, h.isMember, h.member, {
    sessionToken: 'tok',
    installationId: INST,
  });
  return completeLinearConnect(h.deps, h.isMember, h.member, {
    sessionToken,
    code: 'c1',
    state: stateOf(url),
  });
}

describe('startLinearConnect', () => {
  test('builds the linear authorize url with a session bound state', async () => {
    const { deps, member, isMember } = await setup();
    const { url } = await startLinearConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://linear.app/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('lid');
    expect(parsed.searchParams.get('actor')).toBe('app');
    expect(parsed.searchParams.get('scope')).toBe('read');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://sw.test/oauth/linear/callback');
    expect(stateOf(url)).toContain('.');
  });

  test('forbids a member who is not an admin', async () => {
    const { deps, member, isMember, roles } = await setup();
    roles.set('alice', { role: 'member', state: 'active' });
    expect(
      await codeOf(
        startLinearConnect(deps, isMember, member, { sessionToken: 'tok', installationId: INST }),
      ),
    ).toBe('forbidden');
  });
});

describe('completeLinearConnect', () => {
  test('saves the organization with encrypted tokens', async () => {
    const h = await setup();
    expect(await connect(h)).toEqual({ installationId: INST });
    expect(h.linear.calls.exchanges).toEqual([
      { code: 'c1', redirectUri: 'https://sw.test/oauth/linear/callback', clientId: 'lid' },
    ]);
    expect(h.linear.calls.bearer).toEqual(['Bearer lin_at_1']);
    const saved = await getConnection(db, INST, 'linear', KEY);
    expect(saved).toMatchObject({
      externalId: 'org-1',
      externalName: 'Acme Linear',
      externalKey: 'acme',
      invalidatedAt: null,
    });
    expect(JSON.parse(saved?.secret ?? '')).toEqual(h.linear.state.tokens);
    const row = await db.query.connections.findFirst();
    expect(row?.secretCiphertext).not.toContain('lin_at_1');
  });

  test('connecting another organization clears the linear identities', async () => {
    const h = await setup();
    await saveConnection(db, INST, 'linear', 'org-old', '{}', KEY, 'Old', 'old');
    await setIdentity(db, INST, h.member.id, 'linear', 'lin-user-old');
    await setIdentity(db, INST, h.member.id, 'slack', 'U1');
    await connect(h);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U1');
  });

  test('reconnecting the same organization keeps identities and clears the invalid mark', async () => {
    const h = await setup();
    await saveConnection(db, INST, 'linear', 'org-1', '{}', KEY, 'Acme Linear', 'acme');
    await markConnectionInvalid(db, INST, 'linear');
    await setIdentity(db, INST, h.member.id, 'linear', 'lin-user');
    await connect(h);
    expect((await getIdentities(db, INST, 'linear')).get('alice')).toBe('lin-user');
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeNull();
  });

  test('enqueues tracker identity linking after a successful connect', async () => {
    const h = await setup();
    await connect(h);
    expect(h.queue.enqueued).toEqual([
      { name: 'link-tracker-identities', data: { installationId: INST } },
    ]);
  });

  test('forbids a non admin callback and saves nothing', async () => {
    const h = await setup();
    h.roles.set('alice', { role: 'member', state: 'active' });
    const state = signState(
      h.deps.env.sessionSecret,
      { kind: 'linear', installationId: INST, sessionHash: hashSessionToken('tok') },
      h.deps.now(),
    );
    expect(
      await codeOf(
        completeLinearConnect(h.deps, h.isMember, h.member, {
          sessionToken: 'tok',
          code: 'c',
          state,
        }),
      ),
    ).toBe('forbidden');
    expect(h.linear.calls.exchanges).toEqual([]);
    expect(await getConnection(db, INST, 'linear', KEY)).toBeNull();
  });

  test('rejects a state bound to another session', async () => {
    const h = await setup();
    expect(await codeOf(connect(h, 'other'))).toBe('invalid_state');
    expect(h.linear.calls.exchanges).toEqual([]);
    expect(await getConnection(db, INST, 'linear', KEY)).toBeNull();
  });

  test('rejects a slack state', async () => {
    const h = await setup();
    const { url } = await startSlackConnect(h.deps, h.isMember, h.member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    expect(
      await codeOf(
        completeLinearConnect(h.deps, h.isMember, h.member, {
          sessionToken: 'tok',
          code: 'c',
          state: stateOf(url),
        }),
      ),
    ).toBe('invalid_state');
  });

  test('rejects a state for an installation the member cannot access', async () => {
    const h = await setup();
    h.orgMembers.delete('alice');
    await upsertInstallation(db, { id: 12, accountLogin: 'other', accountType: 'Organization' });
    const state = signState(
      h.deps.env.sessionSecret,
      { kind: 'linear', installationId: 12, sessionHash: hashSessionToken('tok') },
      h.deps.now(),
    );
    expect(
      await codeOf(
        completeLinearConnect(h.deps, h.isMember, h.member, {
          sessionToken: 'tok',
          code: 'c',
          state,
        }),
      ),
    ).toBe('forbidden');
    expect(await getConnection(db, 12, 'linear', KEY)).toBeNull();
  });

  test('maps a failed exchange to linear_oauth_failed', async () => {
    const h = await setup();
    h.linear.state.exchangeError = new LinearAuthError('linear oauth http 400');
    expect(await codeOf(connect(h))).toBe('linear_oauth_failed');
    expect(await getConnection(db, INST, 'linear', KEY)).toBeNull();
  });

  test('maps a failed organization read to linear_oauth_failed', async () => {
    const h = await setup();
    h.linear.state.graphqlStatus = 401;
    expect(await codeOf(connect(h))).toBe('linear_oauth_failed');
    expect(await getConnection(db, INST, 'linear', KEY)).toBeNull();
  });

  test('maps access_denied to access_denied', async () => {
    const h = await setup();
    expect(
      await codeOf(
        completeLinearConnect(h.deps, h.isMember, h.member, {
          sessionToken: 'tok',
          error: 'access_denied',
        }),
      ),
    ).toBe('access_denied');
    expect(h.linear.calls.exchanges).toEqual([]);
  });
});
