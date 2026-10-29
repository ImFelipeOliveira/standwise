import type { TeamConfig } from '@standwise/core';
import { getInstallation, type MemberRow } from '@standwise/db';
import type { Deps } from '../deps';
import { currentLogin } from '../membership';
import { isInstallationAdmin } from './is-installation-admin';

export async function findTeamConfig(
  deps: Deps,
  installationId: number,
  team: string,
): Promise<TeamConfig | null> {
  const installation = await getInstallation(deps.db, installationId);
  if (installation?.status !== 'configured' || !installation.config) return null;
  return installation.config.teams.find((t) => t.name === team) ?? null;
}

async function isTeamManager(
  deps: Deps,
  installationId: number,
  member: MemberRow,
  team: TeamConfig,
): Promise<boolean> {
  const octokit = await deps.github.installationOctokit(installationId);
  const login = await currentLogin(octokit, member.githubUserId);
  if (login === null) return false;
  const wanted = login.toLowerCase();
  return team.managers.some((manager) => manager.toLowerCase() === wanted);
}

export async function canReadTeam(
  deps: Deps,
  installationId: number,
  member: MemberRow,
  team: string,
): Promise<boolean> {
  const config = await findTeamConfig(deps, installationId, team);
  if (!config) return false;
  if (await isTeamManager(deps, installationId, member, config)) return true;
  return isInstallationAdmin(deps, installationId, member);
}
