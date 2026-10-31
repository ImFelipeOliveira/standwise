import { describe, expect, test } from 'bun:test';
import {
  getConnection,
  markConnectionInvalid,
  saveConnection,
  setMemberInstallations,
} from '@standwise/db';
import { getOrganization, LinearAuthError, type LinearTokens } from '@standwise/linear';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, getSetupStatus, linearClientFor } from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);

const stored: LinearTokens = {
  accessToken: 'lin_at_1',
  refreshToken: 'lin_rt_1',
  expiresAt: '2026-10-29T15:00:00.000Z',
};

async function setup(tokens: LinearTokens = stored) {
  await seedOrg();
  await saveConnection(db, INST, 'linear', 'org-1', JSON.stringify(tokens), KEY, 'Acme', 'acme');
  return fakeDeps();
}

const savedTokens = async () =>
  JSON.parse((await getConnection(db, INST, 'linear', KEY))?.secret ?? 'null') as LinearTokens;

describe('linearClientFor', () => {
  test('returns null without a linear connection', async () => {
    await seedOrg();
    const { deps } = fakeDeps();
    expect(await linearClientFor(deps, INST)).toBeNull();
  });

  test('returns null for an invalidated connection', async () => {
    const { deps, linear } = await setup();
    await markConnectionInvalid(db, INST, 'linear');
    expect(await linearClientFor(deps, INST)).toBeNull();
    expect(linear.calls.refreshes).toEqual([]);
  });

  test('uses the stored token while it is far from expiry', async () => {
    const { deps, linear } = await setup();
    const access = await linearClientFor(deps, INST);
    expect(access?.organization).toEqual({ id: 'org-1', urlKey: 'acme' });
    if (!access) throw new Error('expected access');
    await getOrganization(access.client);
    expect(linear.calls.bearer).toEqual(['Bearer lin_at_1']);
    expect(linear.calls.refreshes).toEqual([]);
  });

  test('never refreshes a token without expiry', async () => {
    const { deps, linear, setNow } = await setup({ ...stored, expiresAt: null });
    setNow(new Date('2027-01-01T00:00:00Z'));
    expect(await linearClientFor(deps, INST)).not.toBeNull();
    expect(linear.calls.refreshes).toEqual([]);
  });

  test('refreshes near expiry and saves the rotated tokens', async () => {
    const { deps, linear, setNow } = await setup();
    setNow(new Date('2026-10-29T14:56:00Z'));
    const access = await linearClientFor(deps, INST);
    if (!access) throw new Error('expected access');
    expect(linear.calls.refreshes).toEqual([
      { refreshToken: 'lin_rt_1', clientId: 'lid', clientSecret: 'lsecret' },
    ]);
    expect(await savedTokens()).toEqual(linear.state.refreshed);
    await getOrganization(access.client);
    expect(linear.calls.bearer).toEqual(['Bearer lin_at_2']);
  });

  test('keeps the old refresh token when the refresh returns none', async () => {
    const { deps, linear, setNow } = await setup();
    linear.state.refreshed = { accessToken: 'lin_at_2', refreshToken: null, expiresAt: null };
    setNow(new Date('2026-10-29T14:59:00Z'));
    await linearClientFor(deps, INST);
    expect(await savedTokens()).toEqual({
      accessToken: 'lin_at_2',
      refreshToken: 'lin_rt_1',
      expiresAt: null,
    });
  });

  test('concurrent callers refresh only once', async () => {
    const { deps, linear, setNow } = await setup();
    setNow(new Date('2026-10-29T14:56:00Z'));
    const refresh = linear.deps.refreshToken;
    deps.linear = {
      ...deps.linear,
      refreshToken: async (input, fetchImpl) => {
        await Bun.sleep(20);
        return refresh(input, fetchImpl);
      },
    };
    const results = await Promise.all([linearClientFor(deps, INST), linearClientFor(deps, INST)]);
    expect(results.every((r) => r !== null)).toBe(true);
    expect(linear.calls.refreshes).toHaveLength(1);
    expect(await savedTokens()).toEqual(linear.state.refreshed);
  });

  test('a refresh auth failure marks the connection invalid', async () => {
    const { deps, linear, setNow } = await setup();
    linear.state.refreshError = new LinearAuthError('linear oauth http 400');
    setNow(new Date('2026-10-29T14:56:00Z'));
    expect(await linearClientFor(deps, INST)).toBeNull();
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeInstanceOf(Date);
    expect(await savedTokens()).toEqual(stored);
  });

  test('a refresh failure that is not about auth is rethrown without invalidating', async () => {
    const { deps, linear, setNow } = await setup();
    linear.state.refreshError = new Error('linear oauth http 503');
    setNow(new Date('2026-10-29T14:56:00Z'));
    await expect(linearClientFor(deps, INST)).rejects.toThrow('linear oauth http 503');
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeNull();
  });

  test('the setup shows reconnect after a refresh auth failure', async () => {
    const h = await setup();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    h.roles.set('alice', { role: 'admin', state: 'active' });
    h.linear.state.refreshError = new LinearAuthError();
    h.setNow(new Date('2026-10-29T14:56:00Z'));
    await linearClientFor(h.deps, INST);
    const status = await getSetupStatus(h.deps, createMembershipCheck(h.deps), member, INST);
    expect(status.linear).toEqual({
      connected: true,
      workspace: 'Acme',
      urlKey: 'acme',
      invalid: true,
    });
  });
});
