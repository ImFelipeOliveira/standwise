import type { Deps } from './deps';

const TTL_MS = 10 * 60 * 1000;

type Account = { id: number; accountLogin: string; accountType: 'Organization' | 'User' };
type Person = { id: string; login: string };

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

export function createMembershipCheck(
  deps: Deps,
): (account: Account, member: Person) => Promise<boolean> {
  const cache = new Map<string, number>();
  return async (account, member) => {
    if (account.accountType === 'User') {
      return account.accountLogin.toLowerCase() === member.login.toLowerCase();
    }
    const key = `${account.id}:${member.id}`;
    const now = deps.now().getTime();
    const cached = cache.get(key);
    if (cached !== undefined && now - cached < TTL_MS) return true;
    const octokit = await deps.github.installationOctokit(account.id);
    try {
      await octokit.request('GET /orgs/{org}/members/{username}', {
        org: account.accountLogin,
        username: member.login,
      });
    } catch (error) {
      const status = statusOf(error);
      if (status === 404 || status === 302) {
        cache.delete(key);
        return false;
      }
      throw error;
    }
    cache.set(key, now);
    return true;
  };
}
