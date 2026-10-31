import { describe, expect, test } from 'bun:test';
import { listMemberInstallations, setMemberInstallations } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, DomainError, resolveOrgContext } from '../../src';
import { config, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof DomainError ? error.code : undefined;
}

async function setup(cfg: Parameters<typeof seedOrg>[0] = config()) {
  await seedOrg(cfg);
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

describe('resolveOrgContext', () => {
  test('resolves teams and date', async () => {
    const { deps, isMember, member } = await setup();
    const ctx = await resolveOrgContext(deps, isMember, member, 'ACME');
    expect(ctx.installationId).toBe(INST);
    expect(ctx.owner).toBe('acme');
    expect(ctx.mine.map((t) => t.name)).toEqual(['Alpha']);
    expect(ctx.date).toBe('2026-10-28');
  });

  test('renamed member resolves teams with the new login on the first request', async () => {
    const { deps, isMember, member, users, orgMembers } = await setup(config('[alice-new, bob]'));
    users.set(1, 'alice-new');
    orgMembers.add('alice-new');
    const ctx = await resolveOrgContext(deps, isMember, member, 'acme');
    expect(ctx.mine.map((t) => t.name)).toEqual(['Alpha']);
    expect(ctx.member.login).toBe('alice-new');
    expect(ctx.member.id).toBe(member.id);
  });

  test('missing org is invalid_request', async () => {
    const { deps, isMember, member } = await setup();
    expect(await codeOf(resolveOrgContext(deps, isMember, member, undefined))).toBe(
      'invalid_request',
    );
  });

  test('foreign org is org_not_found', async () => {
    const { deps, isMember, member } = await setup();
    await seedOrg(config(), { id: 22, accountLogin: 'globex' });
    expect(await codeOf(resolveOrgContext(deps, isMember, member, 'globex'))).toBe('org_not_found');
  });

  test('removed member is org_not_found and loses the installation', async () => {
    const { deps, isMember, member, orgMembers } = await setup();
    orgMembers.delete('alice');
    expect(await codeOf(resolveOrgContext(deps, isMember, member, 'acme'))).toBe('org_not_found');
    expect(await listMemberInstallations(db, member.id)).toEqual([]);
  });

  test('unconfigured org is org_not_configured', async () => {
    const { deps, isMember, member } = await setup(null);
    expect(await codeOf(resolveOrgContext(deps, isMember, member, 'acme'))).toBe(
      'org_not_configured',
    );
  });

  test('member outside every team is not_in_team', async () => {
    const { deps, isMember, member } = await setup(config('[zed]'));
    expect(await codeOf(resolveOrgContext(deps, isMember, member, 'acme'))).toBe('not_in_team');
  });
});
