import { type ResolvedTeam, teamsForMember } from '@standwise/core';
import { getInstallation } from '@standwise/db';
import type { Deps } from '../deps';
import { resolveTeams } from '../teams';
import { DomainError } from './errors';

export type OrgTeams = { owner: string; teams: ResolvedTeam[] };

export async function loadOrgTeams(deps: Deps, installationId: number): Promise<OrgTeams> {
  const installation = await getInstallation(deps.db, installationId);
  if (!installation) throw new DomainError('org_not_found', 'organization not found');
  if (installation.status !== 'configured' || !installation.config) {
    throw new DomainError('org_not_configured', 'organization has no valid standwise.yml');
  }
  const teams = await resolveTeams(
    deps,
    installation.id,
    installation.accountLogin,
    installation.config,
  );
  return { owner: installation.accountLogin, teams };
}

export function requireTeam(teams: ResolvedTeam[], name: string | undefined) {
  if (name === undefined) return undefined;
  const team = teams.find((t) => t.name === name);
  if (!team) throw new DomainError('invalid_request', `unknown team ${name}`);
  return team;
}

export const teamNames = (login: string, teams: ResolvedTeam[]): string[] =>
  teamsForMember(login, teams).map((t) => t.name);
