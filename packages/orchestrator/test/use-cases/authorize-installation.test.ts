import { describe, expect, test } from 'bun:test';
import { listMemberInstallations, setMemberInstallations } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { authorizeInstallation, createMembershipCheck, type DomainError } from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const codeOf = async (run: Promise<unknown>) =>
  ((await run.catch((e: unknown) => e)) as DomainError).code;

describe('authorizeInstallation', () => {
  test('allows a linked member', async () => {
    await seedOrg();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const { deps } = fakeDeps();
    const result = await authorizeInstallation(deps, createMembershipCheck(deps), member, INST);
    expect(result.installation.id).toBe(INST);
  });

  test('unlinks and forbids a linked member who left the organization', async () => {
    await seedOrg();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const { deps, orgMembers } = fakeDeps();
    orgMembers.delete('alice');
    expect(
      await codeOf(authorizeInstallation(deps, createMembershipCheck(deps), member, INST)),
    ).toBe('forbidden');
    expect(await listMemberInstallations(db, member.id)).toEqual([]);
  });

  test('links an existing installation the member belongs to but was not yet linked', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps } = fakeDeps();
    const result = await authorizeInstallation(deps, createMembershipCheck(deps), member, INST);
    expect(result.installation.id).toBe(INST);
    expect((await listMemberInstallations(db, member.id)).map((i) => i.installationId)).toEqual([
      INST,
    ]);
  });

  test('forbids an unlinked installation of an organization the member is not in', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, orgMembers } = fakeDeps();
    orgMembers.delete('alice');
    expect(
      await codeOf(authorizeInstallation(deps, createMembershipCheck(deps), member, INST)),
    ).toBe('forbidden');
    expect(await listMemberInstallations(db, member.id)).toEqual([]);
  });

  test('reports a pending installation when the row does not exist yet', async () => {
    const member = await seedMember();
    const { deps } = fakeDeps();
    expect(
      await codeOf(authorizeInstallation(deps, createMembershipCheck(deps), member, 404)),
    ).toBe('installation_pending');
  });

  test('forbids a missing or invalid installation id', async () => {
    const member = await seedMember();
    const { deps } = fakeDeps();
    expect(
      await codeOf(authorizeInstallation(deps, createMembershipCheck(deps), member, undefined)),
    ).toBe('forbidden');
  });
});
