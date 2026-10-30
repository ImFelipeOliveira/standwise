import type { Deps } from './deps';
import { scopedTtlCache } from './ttl-cache';

export const GITHUB_INSTALLATIONS_TTL_MS = 10 * 60 * 1000;

const recent = scopedTtlCache<number[]>(GITHUB_INSTALLATIONS_TTL_MS);

export function rememberGitHubInstallations(
  deps: Pick<Deps, 'github' | 'now'>,
  memberId: string,
  installationIds: number[],
): void {
  recent(deps.github).set(memberId, installationIds, deps.now().getTime());
}

export function isOwnGitHubInstallation(
  deps: Pick<Deps, 'github' | 'now'>,
  memberId: string,
  installationId: number,
): boolean {
  return recent(deps.github).get(memberId, deps.now().getTime())?.includes(installationId) ?? false;
}
