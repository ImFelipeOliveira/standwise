import { describe, expect, test } from 'bun:test';
import { getMemberById } from '@standwise/db';
import { db, useCleanDb } from '../../db/test/setup';
import { createMembershipCheck } from '../src';
import { fakeDeps, INST, seedMember } from './use-cases/fakes';

useCleanDb();

const userAccount = (accountLogin: string, accountId: number | null) => ({
  id: INST,
  accountLogin,
  accountType: 'User' as const,
  accountId,
});

const orgAccount = {
  id: INST,
  accountLogin: 'acme',
  accountType: 'Organization' as const,
  accountId: 500,
};

describe('createMembershipCheck', () => {
  test('user installation matches by github id even when logins differ', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls } = fakeDeps();
    const isMember = createMembershipCheck(deps);
    expect(await isMember(userAccount('alice-renamed', 1), member)).toBe(true);
    expect(await isMember(userAccount('ALICE', 1), member)).toBe(true);
    expect(calls.membership).toEqual([]);
  });

  test('user installation with another github id is rejected even with the same login', async () => {
    const member = await seedMember('Alice', 1);
    const { deps } = fakeDeps();
    expect(await createMembershipCheck(deps)(userAccount('alice', 2), member)).toBe(false);
  });

  test('user installation without account id falls back to login', async () => {
    const member = await seedMember('Alice', 1);
    const { deps } = fakeDeps();
    const isMember = createMembershipCheck(deps);
    expect(await isMember(userAccount('ALICE', null), member)).toBe(true);
    expect(await isMember(userAccount('bob', null), member)).toBe(false);
  });

  test('org check uses the current login returned for the github id', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users, orgMembers } = fakeDeps();
    users.set(1, 'alice-new');
    orgMembers.clear();
    orgMembers.add('alice-new');
    expect(await createMembershipCheck(deps)(orgAccount, member)).toBe(true);
    expect(calls.membership).toEqual(['acme/alice-new']);
  });

  test('org check does not trust a stored login now owned by someone else', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users } = fakeDeps();
    users.set(1, 'alice-new');
    expect(await createMembershipCheck(deps)(orgAccount, member)).toBe(false);
    expect(calls.membership).toEqual(['acme/alice-new']);
  });

  test('renamed member has the stored login updated', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, users, orgMembers } = fakeDeps();
    users.set(1, 'alice-new');
    orgMembers.add('alice-new');
    await createMembershipCheck(deps)(orgAccount, member);
    const stored = await getMemberById(db, member.id);
    expect(stored?.login).toBe('alice-new');
    expect(stored?.githubUserId).toBe(1);
    expect(stored?.email).toBe('alice@acme.com');
  });

  test('unchanged login is not rewritten', async () => {
    const member = await seedMember('Alice', 1);
    const { deps } = fakeDeps();
    expect(await createMembershipCheck(deps)(orgAccount, member)).toBe(true);
    expect((await getMemberById(db, member.id))?.login).toBe('Alice');
  });

  test('github user not found is not a member', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users } = fakeDeps();
    users.clear();
    expect(await createMembershipCheck(deps)(orgAccount, member)).toBe(false);
    expect(calls.membership).toEqual([]);
  });

  test('positive org result is cached for ten minutes', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, setNow } = fakeDeps();
    const isMember = createMembershipCheck(deps);
    await isMember(orgAccount, member);
    await isMember(orgAccount, member);
    expect(calls.membership).toHaveLength(1);
    setNow(new Date('2026-10-28T15:11:00Z'));
    await isMember(orgAccount, member);
    expect(calls.membership).toHaveLength(2);
  });
});
