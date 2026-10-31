import { describe, expect, test } from 'bun:test';
import {
  claimDelivery,
  createApiKey,
  failDelivery,
  revokeApiKey,
  setInstallationConfig,
  setMemberInstallations,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, getSetupStatus } from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup(admin: boolean) {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  if (admin) fake.roles.set('alice', { role: 'admin', state: 'active' });
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

describe('getSetupStatus api keys', () => {
  test('an admin gets the key list, revoked keys included, without secrets', async () => {
    const { deps, isMember, member } = await setup(true);
    const first = await createApiKey(db, {
      installationId: INST,
      name: 'first',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    await createApiKey(db, {
      installationId: INST,
      name: 'second',
      scopes: ['dailies:read'],
      createdBy: member.id,
    });
    await revokeApiKey(db, INST, first.id);
    const status = await getSetupStatus(deps, isMember, member, INST);
    if (!status.apiKeys.manage) throw new Error('expected admin');
    expect(status.apiKeys.keys.map((k) => [k.name, k.revokedAt !== null]).sort()).toEqual([
      ['first', true],
      ['second', false],
    ]);
    expect(JSON.stringify(status.apiKeys)).not.toContain(first.key);
  });

  test('a plain member gets no key data at all', async () => {
    const { deps, isMember, member } = await setup(false);
    await createApiKey(db, {
      installationId: INST,
      name: 'hidden',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    const status = await getSetupStatus(deps, isMember, member, INST);
    expect(status.apiKeys).toEqual({ manage: false });
  });

  test('a github failure on the admin check hides the section and keeps the page', async () => {
    const { deps, isMember, member, failRoles } = await setup(true);
    failRoles(Object.assign(new Error('boom'), { status: 502 }));
    const status = await getSetupStatus(deps, isMember, member, INST);
    expect(status.apiKeys).toEqual({ manage: false });
    expect(status.owner).toBe('acme');
  });
});

describe('getSetupStatus config', () => {
  const errors = [{ path: 'teams', message: 'bad' }];

  test('an invalid file keeps the last valid config in use', async () => {
    const { deps, isMember, member } = await setup(false);
    await setInstallationConfig(db, INST, { status: 'invalid', errors });
    expect((await getSetupStatus(deps, isMember, member, INST)).config).toEqual({
      status: 'invalid',
      errors,
      lastValid: true,
    });
  });

  test('an invalid file without a previous valid config has nothing in use', async () => {
    await seedOrg(null);
    await setInstallationConfig(db, INST, { status: 'invalid', errors });
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const fake = fakeDeps();
    const status = await getSetupStatus(fake.deps, createMembershipCheck(fake.deps), member, INST);
    expect(status.config).toEqual({ status: 'invalid', errors, lastValid: false });
  });
});

describe('getSetupStatus failed deliveries', () => {
  async function fail(k: Parameters<typeof claimDelivery>[1], error: string) {
    const claim = await claimDelivery(db, k);
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await failDelivery(db, k, claim.token, error);
  }

  test('team failures and grouped person failures, without blocker subjects or hidden kinds', async () => {
    const { deps, isMember, member } = await setup(false);
    const base = { installationId: INST, teamName: '', date: '2026-10-28' };
    await fail(
      { ...base, teamName: 'Alpha', kind: 'digest' },
      'not_in_channel: the bot is not in the channel',
    );
    await fail({ ...base, kind: 'reminder', subject: 'bob' }, 'no_chat_identity: bob');
    await fail(
      { ...base, kind: 'blocker_route', subject: 'daily-1:abc:mgr' },
      'no_chat_identity: mgr',
    );
    await fail(
      { ...base, kind: 'blocker_route', subject: 'daily-2:def:mgr' },
      'no_chat_identity: mgr',
    );
    await fail({ ...base, kind: 'suggestion_dm', subject: 'm:pr_no_review:x' }, 'no_chat_identity');
    await fail(
      { ...base, kind: 'signal_scan', subject: 'alice' },
      'internal_error: unexpected error',
    );
    const status = await getSetupStatus(deps, isMember, member, INST);
    expect(status.teamFailures.map((f) => [f.kind, f.team, f.error])).toEqual([
      ['digest', 'Alpha', 'not_in_channel: the bot is not in the channel'],
    ]);
    expect(status.personFailures.map((f) => [f.kind, f.error, f.count]).sort()).toEqual([
      ['blocker_route', 'no_chat_identity: mgr', 2],
      ['reminder', 'no_chat_identity: bob', 1],
    ]);
    const json = JSON.stringify(status);
    expect(json).not.toContain('daily-1');
    expect(json).not.toContain('pr_no_review');
    expect(json).not.toContain('suggestion_dm');
    expect(json).not.toContain('signal_scan');
  });
});
