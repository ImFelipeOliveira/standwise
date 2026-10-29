import { describe, expect, test } from 'bun:test';
import { createApiKey, listApiKeys, resolveApiKey, setMemberInstallations } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  createInstallationApiKey,
  createMembershipCheck,
  DomainError,
  revokeInstallationApiKey,
} from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup(admin = true) {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  if (admin) fake.roles.set('alice', { role: 'admin', state: 'active' });
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof DomainError ? error.code : undefined;
}

const input = { installationId: INST, name: 'CI', scopes: ['teams:read' as const] };

describe('createInstallationApiKey', () => {
  test('an admin creates a key that resolves to the installation', async () => {
    const { deps, isMember, member } = await setup();
    const { id, key } = await createInstallationApiKey(deps, isMember, member, {
      ...input,
      name: '  CI  ',
      scopes: ['teams:read', 'dailies:read', 'teams:read'],
    });
    expect(key).toStartWith('swk_');
    expect(await resolveApiKey(db, key)).toEqual({
      id,
      installationId: INST,
      scopes: ['teams:read', 'dailies:read'],
    });
    const [listed] = await listApiKeys(db, INST);
    expect(listed?.name).toBe('CI');
    expect(listed?.id).toBe(id);
  });

  test('a non-admin member is forbidden and nothing is created', async () => {
    const { deps, isMember, member } = await setup(false);
    expect(await codeOf(createInstallationApiKey(deps, isMember, member, input))).toBe('forbidden');
    expect(await listApiKeys(db, INST)).toEqual([]);
  });

  test('someone outside the installation is forbidden', async () => {
    const { deps, isMember, member, orgMembers } = await setup();
    orgMembers.delete('alice');
    expect(await codeOf(createInstallationApiKey(deps, isMember, member, input))).toBe('forbidden');
  });

  test.each([
    ['empty name', { ...input, name: '   ' }],
    ['long name', { ...input, name: 'x'.repeat(81) }],
    ['no scopes', { ...input, scopes: [] }],
    ['unknown scope', { ...input, scopes: ['admin:write' as never] }],
  ])('%s is invalid_request', async (_label, bad) => {
    const { deps, isMember, member } = await setup();
    expect(await codeOf(createInstallationApiKey(deps, isMember, member, bad))).toBe(
      'invalid_request',
    );
    expect(await listApiKeys(db, INST)).toEqual([]);
  });
});

describe('revokeInstallationApiKey', () => {
  test('an admin revokes a key', async () => {
    const { deps, isMember, member } = await setup();
    const { id, key } = await createInstallationApiKey(deps, isMember, member, input);
    expect(await revokeInstallationApiKey(deps, isMember, member, INST, id)).toBe(true);
    expect(await resolveApiKey(db, key)).toBeNull();
  });

  test('a non-admin cannot revoke', async () => {
    const { deps, isMember, member, roles } = await setup();
    const { id, key } = await createInstallationApiKey(deps, isMember, member, input);
    roles.clear();
    const { deps: other } = fakeDeps();
    const outsider = createMembershipCheck(other);
    expect(await codeOf(revokeInstallationApiKey(other, outsider, member, INST, id))).toBe(
      'forbidden',
    );
    expect(await resolveApiKey(db, key)).not.toBeNull();
  });

  test('a malformed key id is not revoked and does not fail', async () => {
    const { deps, isMember, member } = await setup();
    expect(await revokeInstallationApiKey(deps, isMember, member, INST, 'nope')).toBe(false);
  });

  test('a key id from another installation is not revoked', async () => {
    const { deps, isMember, member } = await setup();
    await seedOrg(undefined, { id: 22, accountLogin: 'globex' });
    const foreign = await createApiKey(db, {
      installationId: 22,
      name: 'foreign',
      scopes: ['teams:read'],
      createdBy: member.id,
    });
    expect(await revokeInstallationApiKey(deps, isMember, member, INST, foreign.id)).toBe(false);
    expect(await resolveApiKey(db, foreign.key)).not.toBeNull();
  });
});
