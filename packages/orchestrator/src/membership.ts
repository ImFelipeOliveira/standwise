import { type InstallationRow, type MemberRow, updateMemberLogin } from '@standwise/db';
import type { Deps } from './deps';
import { scopedTtlCache } from './ttl-cache';

const TTL_MS = 10 * 60 * 1000;
export const LOGIN_CACHE_TTL_MS = 10 * 60 * 1000;

const loginCache = scopedTtlCache<string>(LOGIN_CACHE_TTL_MS);
const membershipCache = scopedTtlCache<boolean>(TTL_MS);

export function forgetMembership(
  deps: Pick<Deps, 'github'>,
  installationIds: number[],
  memberId: string,
): void {
  const cache = membershipCache(deps.github);
  for (const id of installationIds) cache.delete(`${id}:${memberId}`);
}

type Account = Pick<InstallationRow, 'id' | 'accountLogin' | 'accountType' | 'accountId'>;
export type Octokit = Awaited<ReturnType<Deps['github']['installationOctokit']>>;

export function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

export function isUserAccountOwner(account: Account, member: MemberRow): boolean {
  if (account.accountId !== null) return account.accountId === member.githubUserId;
  return account.accountLogin.toLowerCase() === member.login.toLowerCase();
}

export async function currentLogin(
  deps: Pick<Deps, 'github' | 'now'>,
  octokit: Octokit,
  githubUserId: number,
  options: { fresh?: boolean } = {},
): Promise<string | null> {
  const cache = loginCache(deps.github);
  const key = String(githubUserId);
  const cached = options.fresh ? undefined : cache.get(key, deps.now().getTime());
  if (cached !== undefined) return cached;
  try {
    const response = await octokit.request('GET /user/{account_id}', {
      account_id: githubUserId,
    });
    cache.set(key, response.data.login, deps.now().getTime());
    return response.data.login;
  } catch (error) {
    if (statusOf(error) === 404) {
      cache.delete(key);
      return null;
    }
    throw error;
  }
}

async function isOrgMember(octokit: Octokit, org: string, username: string): Promise<boolean> {
  try {
    await octokit.request('GET /orgs/{org}/members/{username}', { org, username });
    return true;
  } catch (error) {
    const status = statusOf(error);
    if (status === 404 || status === 302) return false;
    throw error;
  }
}

export function createMembershipCheck(
  deps: Deps,
): (account: Account, member: MemberRow) => Promise<MemberRow | null> {
  const cache = membershipCache(deps.github);
  return async (account, member) => {
    if (account.accountType === 'User') return isUserAccountOwner(account, member) ? member : null;
    const key = `${account.id}:${member.id}`;
    const now = deps.now().getTime();
    const cached = cache.get(key, now);
    if (cached !== undefined) return cached ? member : null;
    const remember = (isMember: boolean) => cache.set(key, isMember, now);
    const octokit = await deps.github.installationOctokit(account.id);
    const login = await currentLogin(deps, octokit, member.githubUserId);
    if (login === null) {
      remember(false);
      return null;
    }
    const current =
      login === member.login
        ? member
        : ((await updateMemberLogin(deps.db, member.githubUserId, login)) ?? { ...member, login });
    if (!(await isOrgMember(octokit, account.accountLogin, login))) {
      remember(false);
      return null;
    }
    remember(true);
    return current;
  };
}
