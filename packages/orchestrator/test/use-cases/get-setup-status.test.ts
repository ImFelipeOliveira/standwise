import { describe, expect, test } from 'bun:test';
import { createApiKey, revokeApiKey, setMemberInstallations } from '@standwise/db';
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
});
