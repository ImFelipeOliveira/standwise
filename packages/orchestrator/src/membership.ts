import { type InstallationRow, type MemberRow, updateMemberLogin } from '@standwise/db';
import type { Deps } from './deps';

const TTL_MS = 10 * 60 * 1000;

type Account = Pick<InstallationRow, 'id' | 'accountLogin' | 'accountType' | 'accountId'>;
type Octokit = Awaited<ReturnType<Deps['github']['installationOctokit']>>;

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function isUserAccountOwner(account: Account, member: MemberRow): boolean {
  if (account.accountId !== null) return account.accountId === member.githubUserId;
  return account.accountLogin.toLowerCase() === member.login.toLowerCase();
}

async function currentLogin(octokit: Octokit, githubUserId: number): Promise<string | null> {
  try {
    const response = await octokit.request('GET /user/{account_id}', {
      account_id: githubUserId,
    });
    return response.data.login;
  } catch (error) {
    if (statusOf(error) === 404) return null;
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
  const cache = new Map<string, number>();
  return async (account, member) => {
    if (account.accountType === 'User') return isUserAccountOwner(account, member) ? member : null;
    const key = `${account.id}:${member.id}`;
    const now = deps.now().getTime();
    const cached = cache.get(key);
    if (cached !== undefined && now - cached < TTL_MS) return member;
    const octokit = await deps.github.installationOctokit(account.id);
    const login = await currentLogin(octokit, member.githubUserId);
    if (login === null) {
      cache.delete(key);
      return null;
    }
    const current =
      login === member.login
        ? member
        : ((await updateMemberLogin(deps.db, member.githubUserId, login)) ?? { ...member, login });
    if (!(await isOrgMember(octokit, account.accountLogin, login))) {
      cache.delete(key);
      return null;
    }
    cache.set(key, now);
    return current;
  };
}
