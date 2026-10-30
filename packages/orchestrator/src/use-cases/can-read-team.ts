import type { TeamConfig } from '@standwise/core';
import { getInstallation, type MemberRow, operationalConfig } from '@standwise/db';
import type { Deps } from '../deps';
import { currentLogin } from '../membership';
import { isInstallationAdmin } from './is-installation-admin';

async function configuredTeams(deps: Deps, installationId: number): Promise<TeamConfig[]> {
  return operationalConfig(await getInstallation(deps.db, installationId))?.teams ?? [];
}

export async function readableTeams(
  deps: Deps,
  installationId: number,
  member: MemberRow,
): Promise<TeamConfig[]> {
  const teams = await configuredTeams(deps, installationId);
  if (teams.length === 0) return [];
  const octokit = await deps.github.installationOctokit(installationId);
  const login = (await currentLogin(deps, octokit, member.githubUserId))?.toLowerCase();
  const managed = teams.filter(
    (team) => login !== undefined && team.managers.some((m) => m.toLowerCase() === login),
  );
  if (managed.length === teams.length) return managed;
  return (await isInstallationAdmin(deps, installationId, member)) ? teams : managed;
}

export async function canReadTeam(
  deps: Deps,
  installationId: number,
  member: MemberRow,
  team: string,
): Promise<boolean> {
  return (await readableTeams(deps, installationId, member)).some((t) => t.name === team);
}
