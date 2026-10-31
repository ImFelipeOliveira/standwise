import { describe, expect, test } from 'bun:test';
import { getMemberById } from '@standwise/db';
import { db, useCleanDb } from '../../db/test/setup';
import {
  createMembershipCheck,
  currentLogin,
  LOGIN_CACHE_TTL_MS,
  startSession,
  syncMemberFromGitHub,
} from '../src';
import { fakeDeps, INST, seedMember, seedOrg } from './use-cases/fakes';

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
    expect((await isMember(userAccount('alice-renamed', 1), member))?.id).toBe(member.id);
    expect((await isMember(userAccount('ALICE', 1), member))?.id).toBe(member.id);
    expect(calls.membership).toEqual([]);
  });

  test('user installation with another github id is rejected even with the same login', async () => {
    const member = await seedMember('Alice', 1);
    const { deps } = fakeDeps();
    expect(await createMembershipCheck(deps)(userAccount('alice', 2), member)).toBeNull();
  });

  test('user installation without account id falls back to login', async () => {
    const member = await seedMember('Alice', 1);
    const { deps } = fakeDeps();
    const isMember = createMembershipCheck(deps);
    expect((await isMember(userAccount('ALICE', null), member))?.id).toBe(member.id);
    expect(await isMember(userAccount('bob', null), member)).toBeNull();
  });

  test('org check uses the current login returned for the github id', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users, orgMembers } = fakeDeps();
    users.set(1, 'alice-new');
    orgMembers.clear();
    orgMembers.add('alice-new');
    expect((await createMembershipCheck(deps)(orgAccount, member))?.id).toBe(member.id);
    expect(calls.membership).toEqual(['acme/alice-new']);
  });

  test('org check does not trust a stored login now owned by someone else', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users } = fakeDeps();
    users.set(1, 'alice-new');
    expect(await createMembershipCheck(deps)(orgAccount, member)).toBeNull();
    expect(calls.membership).toEqual(['acme/alice-new']);
  });

  test('renamed member has the stored login updated', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, users, orgMembers } = fakeDeps();
    users.set(1, 'alice-new');
    orgMembers.add('alice-new');
    const refreshed = await createMembershipCheck(deps)(orgAccount, {
      ...member,
      email: 'stale@acme.com',
    });
    expect(refreshed?.login).toBe('alice-new');
    const stored = await getMemberById(db, member.id);
    expect(stored?.login).toBe('alice-new');
    expect(stored?.githubUserId).toBe(1);
    expect(stored?.email).toBe('alice@acme.com');
  });

  test('unchanged login is not rewritten', async () => {
    const member = await seedMember('Alice', 1);
    const { deps } = fakeDeps();
    expect((await createMembershipCheck(deps)(orgAccount, member))?.id).toBe(member.id);
    expect((await getMemberById(db, member.id))?.login).toBe('Alice');
  });

  test('non-404 failure looking up the github user propagates', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, failUserLookup } = fakeDeps();
    const boom = Object.assign(new Error('boom'), { status: 500 });
    failUserLookup(boom);
    expect(await createMembershipCheck(deps)(orgAccount, member).catch((e: unknown) => e)).toBe(
      boom,
    );
    expect(calls.membership).toEqual([]);
  });

  test('github user not found is not a member', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users } = fakeDeps();
    users.clear();
    expect(await createMembershipCheck(deps)(orgAccount, member)).toBeNull();
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

describe('membership negative cache', () => {
  test('a repeated probe makes one github call within ten minutes', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, orgMembers, setNow } = fakeDeps();
    orgMembers.clear();
    const isMember = createMembershipCheck(deps);
    expect(await isMember(orgAccount, member)).toBeNull();
    expect(await isMember(orgAccount, member)).toBeNull();
    expect(calls.membership).toHaveLength(1);
    setNow(new Date('2026-10-28T15:09:59Z'));
    expect(await isMember(orgAccount, member)).toBeNull();
    expect(calls.membership).toHaveLength(1);
    setNow(new Date('2026-10-28T15:10:00Z'));
    await isMember(orgAccount, member);
    expect(calls.membership).toHaveLength(2);
  });

  test('an unknown github user is cached as not a member', async () => {
    const member = await seedMember('Alice', 1);
    const { deps, calls, users } = fakeDeps();
    users.clear();
    const isMember = createMembershipCheck(deps);
    await isMember(orgAccount, member);
    await isMember(orgAccount, member);
    expect(calls.users).toEqual([1]);
  });
});

describe('membership cache and login', () => {
  test('device login clears a cached negative so a new member gets in at once', async () => {
    await seedOrg();
    const member = await seedMember('Alice', 1);
    const { deps, orgMembers } = fakeDeps();
    orgMembers.clear();
    const isMember = createMembershipCheck(deps);
    expect(await isMember(orgAccount, member)).toBeNull();
    orgMembers.add('alice');
    expect(await isMember(orgAccount, member)).toBeNull();
    await startSession(deps, { githubToken: 'gho_x' });
    expect((await isMember(orgAccount, member))?.id).toBe(member.id);
  });

  test('web login clears a cached negative too', async () => {
    await seedOrg();
    const member = await seedMember('Alice', 1);
    const { deps, orgMembers } = fakeDeps();
    orgMembers.clear();
    const isMember = createMembershipCheck(deps);
    expect(await isMember(orgAccount, member)).toBeNull();
    orgMembers.add('alice');
    await syncMemberFromGitHub(deps, 'gho_x');
    expect((await isMember(orgAccount, member))?.id).toBe(member.id);
  });
});

describe('currentLogin', () => {
  test('caches the login of a github id for ten minutes', async () => {
    const { deps, calls, setNow } = fakeDeps();
    const octokit = await deps.github.installationOctokit(INST);
    expect(await currentLogin(deps, octokit, 1)).toBe('Alice');
    expect(await currentLogin(deps, octokit, 1)).toBe('Alice');
    expect(calls.users).toEqual([1]);
    setNow(new Date(deps.now().getTime() + LOGIN_CACHE_TTL_MS));
    await currentLogin(deps, octokit, 1);
    expect(calls.users).toEqual([1, 1]);
  });

  test('a fresh lookup skips the cache', async () => {
    const { deps, calls, users } = fakeDeps();
    const octokit = await deps.github.installationOctokit(INST);
    await currentLogin(deps, octokit, 1);
    users.set(1, 'alice-new');
    expect(await currentLogin(deps, octokit, 1, { fresh: true })).toBe('alice-new');
    expect(await currentLogin(deps, octokit, 1)).toBe('alice-new');
    expect(calls.users).toEqual([1, 1]);
  });
});
