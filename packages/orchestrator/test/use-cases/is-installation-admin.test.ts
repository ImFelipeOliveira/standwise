import { describe, expect, test } from 'bun:test';
import { upsertInstallation } from '@standcast/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { isInstallationAdmin } from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const FIVE_MINUTES = 5 * 60 * 1000;

describe('isInstallationAdmin', () => {
  test('user account: only the owner by github id is admin', async () => {
    await upsertInstallation(db, {
      id: INST,
      accountLogin: 'alice',
      accountType: 'User',
      accountId: 1,
    });
    const alice = await seedMember('alice', 1);
    const bob = await seedMember('bob', 2);
    const { deps, calls } = fakeDeps();
    expect(await isInstallationAdmin(deps, INST, alice)).toBe(true);
    expect(await isInstallationAdmin(deps, INST, bob)).toBe(false);
    expect(calls.roles).toEqual([]);
  });

  test('user account without account id falls back to the login', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'Alice', accountType: 'User' });
    const alice = await seedMember('alice', 1);
    const bob = await seedMember('bob', 2);
    const { deps } = fakeDeps();
    expect(await isInstallationAdmin(deps, INST, alice)).toBe(true);
    expect(await isInstallationAdmin(deps, INST, bob)).toBe(false);
  });

  test('organization: active admin is admin', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, roles, calls } = fakeDeps();
    roles.set('alice', { role: 'admin', state: 'active' });
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    expect(calls.roles).toEqual(['acme/Alice']);
  });

  test('organization: plain member, pending admin and non-member are not admins', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, roles } = fakeDeps();
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
    roles.set('alice', { role: 'member', state: 'active' });
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
    roles.set('alice', { role: 'admin', state: 'pending' });
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
  });

  test('organization: resolves the current login through the github user id', async () => {
    await seedOrg();
    const member = await seedMember('old-name', 1);
    const { deps, roles, users, calls } = fakeDeps();
    users.set(1, 'new-name');
    roles.set('new-name', { role: 'admin', state: 'active' });
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    expect(calls.roles).toEqual(['acme/new-name']);
  });

  test('organization: a deleted github user is not admin', async () => {
    await seedOrg();
    const member = await seedMember('ghost', 9);
    const { deps } = fakeDeps();
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
  });

  test('unknown installation is not admin', async () => {
    const member = await seedMember();
    const { deps } = fakeDeps();
    expect(await isInstallationAdmin(deps, 999, member)).toBe(false);
  });

  test('github failures other than 404 surface', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, failUserLookup } = fakeDeps();
    failUserLookup(Object.assign(new Error('boom'), { status: 500 }));
    await expect(isInstallationAdmin(deps, INST, member)).rejects.toThrow('boom');
  });

  test('positive results are cached for five minutes, negatives are not', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, roles, calls, setNow } = fakeDeps();
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
    roles.set('alice', { role: 'admin', state: 'active' });
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    expect(calls.roles).toHaveLength(2);
    roles.delete('alice');
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    expect(calls.roles).toHaveLength(2);
    setNow(new Date(new Date('2026-10-28T15:00:00Z').getTime() + FIVE_MINUTES + 1));
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
    expect(calls.roles).toHaveLength(3);
  });

  test('fresh bypasses the cache and refreshes it', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, roles, calls } = fakeDeps();
    roles.set('alice', { role: 'admin', state: 'active' });
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    roles.delete('alice');
    expect(await isInstallationAdmin(deps, INST, member, { fresh: true })).toBe(false);
    expect(calls.roles).toHaveLength(2);
    expect(await isInstallationAdmin(deps, INST, member)).toBe(false);
    expect(calls.roles).toHaveLength(3);
    roles.set('alice', { role: 'admin', state: 'active' });
    expect(await isInstallationAdmin(deps, INST, member, { fresh: true })).toBe(true);
    roles.delete('alice');
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    expect(calls.roles).toHaveLength(4);
  });
});
