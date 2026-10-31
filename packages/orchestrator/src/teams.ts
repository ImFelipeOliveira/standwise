import type { ResolvedTeam, StandwiseConfig } from '@standwise/core';
import type { Deps } from './deps';
import { scopedTtlCache } from './ttl-cache';

export const TEAMS_CACHE_TTL_MS = 5 * 60 * 1000;

export type TeamNotice = { team: string; reference: string; kind: 'missing' | 'truncated' };

type CachedTeam = { logins: string[]; missingTeams: string[]; truncatedTeams: string[] };

const membersCache = scopedTtlCache<CachedTeam>(TEAMS_CACHE_TTL_MS);

const keyPrefix = (installationId: number) => `${installationId}:`;

export function invalidateResolvedTeams(deps: Pick<Deps, 'github'>, installationId: number): void {
  const prefix = keyPrefix(installationId);
  membersCache(deps.github).deleteWhere((key) => key.startsWith(prefix));
}

async function resolveTeamsWithNotices(
  deps: Pick<Deps, 'github' | 'now'>,
  installationId: number,
  owner: string,
  config: StandwiseConfig,
): Promise<{ teams: ResolvedTeam[]; notices: TeamNotice[] }> {
  const cache = membersCache(deps.github);
  let octokit: Awaited<ReturnType<Deps['github']['installationOctokit']>> | undefined;
  const teams: ResolvedTeam[] = [];
  const notices: TeamNotice[] = [];
  for (const team of config.teams) {
    const key = `${keyPrefix(installationId)}${owner.toLowerCase()}:${JSON.stringify(team.members)}`;
    let entry = cache.get(key, deps.now().getTime());
    if (!entry) {
      octokit ??= await deps.github.installationOctokit(installationId);
      const resolved = await deps.github.resolveTeamMembers(octokit, owner, team.members);
      entry = {
        logins: [...new Set(resolved.logins.map((l) => l.toLowerCase()))],
        missingTeams: resolved.missingTeams,
        truncatedTeams: resolved.truncatedTeams,
      };
      cache.set(key, entry, deps.now().getTime());
    }
    teams.push({ ...team, memberLogins: entry.logins });
    for (const reference of entry.missingTeams) {
      notices.push({ team: team.name, reference, kind: 'missing' });
    }
    for (const reference of entry.truncatedTeams) {
      notices.push({ team: team.name, reference, kind: 'truncated' });
    }
  }
  return { teams, notices };
}

export async function resolveTeams(
  deps: Pick<Deps, 'github' | 'now'>,
  installationId: number,
  owner: string,
  config: StandwiseConfig,
): Promise<ResolvedTeam[]> {
  return (await resolveTeamsWithNotices(deps, installationId, owner, config)).teams;
}

export async function teamResolutionNotices(
  deps: Pick<Deps, 'github' | 'now'>,
  installationId: number,
  owner: string,
  config: StandwiseConfig,
): Promise<TeamNotice[]> {
  return (await resolveTeamsWithNotices(deps, installationId, owner, config)).notices;
}
