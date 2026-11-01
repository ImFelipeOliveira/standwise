import { describe, expect, test } from 'bun:test';
import { listMemberInstallations, setMemberInstallations } from '@standcast/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  authorizeInstallation,
  createMembershipCheck,
  type DomainError,
  syncMemberFromGitHub,
} from '../../src';
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

  test('reports a pending installation only for the member own fresh github installations', async () => {
    await seedOrg();
    const { deps } = fakeDeps({ installationIds: [INST, 999] });
    const { member } = await syncMemberFromGitHub(deps, 'ghu_token');
    const isMember = createMembershipCheck(deps);
    expect(await codeOf(authorizeInstallation(deps, isMember, member, 999))).toBe(
      'installation_pending',
    );
    expect(await codeOf(authorizeInstallation(deps, isMember, member, 404))).toBe('forbidden');
  });

  test('a missing installation and a foreign one fail the same way', async () => {
    await seedOrg();
    await seedOrg(null, { id: 12, accountLogin: 'other' });
    const member = await seedMember();
    const { deps, orgMembers } = fakeDeps();
    orgMembers.delete('alice');
    const isMember = createMembershipCheck(deps);
    const missing = await authorizeInstallation(deps, isMember, member, 404).catch((e) => e);
    const foreign = await authorizeInstallation(deps, isMember, member, 12).catch((e) => e);
    expect(missing.code).toBe('forbidden');
    expect(foreign.code).toBe('forbidden');
    expect(missing.message).toBe(foreign.message);
    expect(missing.constructor).toBe(foreign.constructor);
  });

  test('forbids a missing or invalid installation id', async () => {
    const member = await seedMember();
    const { deps } = fakeDeps();
    expect(
      await codeOf(authorizeInstallation(deps, createMembershipCheck(deps), member, undefined)),
    ).toBe('forbidden');
  });
});
