import type { ResolvedTeam, StandwiseConfig } from '@standwise/core';
import type { Deps } from './deps';

export async function resolveTeams(
  deps: Pick<Deps, 'github'>,
  installationId: number,
  owner: string,
  config: StandwiseConfig,
): Promise<ResolvedTeam[]> {
  const octokit = await deps.github.installationOctokit(installationId);
  const teams: ResolvedTeam[] = [];
  for (const team of config.teams) {
    const logins = await deps.github.resolveTeamMembers(octokit, owner, team.members);
    teams.push({ ...team, memberLogins: [...new Set(logins.map((l) => l.toLowerCase()))] });
  }
  return teams;
}
