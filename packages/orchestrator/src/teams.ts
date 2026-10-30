import type { ResolvedTeam, StandwiseConfig } from '@standwise/core';
import type { Deps } from './deps';
import { scopedTtlCache } from './ttl-cache';

export const TEAMS_CACHE_TTL_MS = 5 * 60 * 1000;

const membersCache = scopedTtlCache<string[]>(TEAMS_CACHE_TTL_MS);

const keyPrefix = (installationId: number) => `${installationId}:`;

export function invalidateResolvedTeams(deps: Pick<Deps, 'github'>, installationId: number): void {
  const prefix = keyPrefix(installationId);
  membersCache(deps.github).deleteWhere((key) => key.startsWith(prefix));
}

export async function resolveTeams(
  deps: Pick<Deps, 'github' | 'now'>,
  installationId: number,
  owner: string,
  config: StandwiseConfig,
): Promise<ResolvedTeam[]> {
  const cache = membersCache(deps.github);
  let octokit: Awaited<ReturnType<Deps['github']['installationOctokit']>> | undefined;
  const teams: ResolvedTeam[] = [];
  for (const team of config.teams) {
    const key = `${keyPrefix(installationId)}${owner.toLowerCase()}:${JSON.stringify(team.members)}`;
    let logins = cache.get(key, deps.now().getTime());
    if (!logins) {
      octokit ??= await deps.github.installationOctokit(installationId);
      const resolved = await deps.github.resolveTeamMembers(octokit, owner, team.members);
      logins = [...new Set(resolved.map((l) => l.toLowerCase()))];
      cache.set(key, logins, deps.now().getTime());
    }
    teams.push({ ...team, memberLogins: logins });
  }
  return teams;
}
