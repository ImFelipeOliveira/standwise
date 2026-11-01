import { getInstallation, type MemberRow } from '@standcast/db';
import type { Deps } from '../deps';
import { currentLogin, isUserAccountOwner, statusOf } from '../membership';

const TTL_MS = 5 * 60 * 1000;

const caches = new WeakMap<object, Map<string, number>>();

function cacheFor(deps: Deps): Map<string, number> {
  const existing = caches.get(deps);
  if (existing) return existing;
  const created = new Map<string, number>();
  caches.set(deps, created);
  return created;
}

export async function isInstallationAdmin(
  deps: Deps,
  installationId: number,
  member: MemberRow,
  options: { fresh?: boolean } = {},
): Promise<boolean> {
  const installation = await getInstallation(deps.db, installationId);
  if (!installation) return false;
  if (installation.accountType === 'User') {
    return isUserAccountOwner(installation, member);
  }
  const cache = cacheFor(deps);
  const key = `${installationId}:${member.githubUserId}`;
  const now = deps.now().getTime();
  const cached = cache.get(key);
  if (!options.fresh && cached !== undefined && now - cached < TTL_MS) return true;
  const octokit = await deps.github.installationOctokit(installationId);
  const login = await currentLogin(deps, octokit, member.githubUserId, options);
  if (login === null) {
    cache.delete(key);
    return false;
  }
  try {
    const response = await octokit.request('GET /orgs/{org}/memberships/{username}', {
      org: installation.accountLogin,
      username: login,
    });
    const admin = response.data.role === 'admin' && response.data.state === 'active';
    if (admin) cache.set(key, now);
    else cache.delete(key);
    return admin;
  } catch (error) {
    if (statusOf(error) === 404) {
      cache.delete(key);
      return false;
    }
    throw error;
  }
}
