import { dailyDateFor, type ResolvedTeam, teamsForMember } from '@standcast/core';
import {
  getInstallation,
  listMemberInstallations,
  type MemberRow,
  operationalConfig,
  removeMemberInstallation,
} from '@standcast/db';
import type { Deps } from '../deps';
import type { createMembershipCheck } from '../membership';
import { resolveTeams } from '../teams';
import { DomainError } from './errors';

export type OrgContext = {
  member: MemberRow;
  installationId: number;
  owner: string;
  config: NonNullable<ReturnType<typeof operationalConfig>>;
  mine: [ResolvedTeam, ...ResolvedTeam[]];
  date: string;
};

export type MembershipCheck = ReturnType<typeof createMembershipCheck>;

export async function resolveOrgContext(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  org: string | undefined,
): Promise<OrgContext> {
  if (!org) throw new DomainError('invalid_request', 'org is required');
  const wanted = org.toLowerCase();
  const entry = (await listMemberInstallations(deps.db, member.id)).find(
    (i) => i.accountLogin.toLowerCase() === wanted,
  );
  if (!entry) throw new DomainError('org_not_found', `organization ${org} not found`);
  const installation = await getInstallation(deps.db, entry.installationId);
  const current = installation ? await isMember(installation, member) : null;
  if (!installation || !current) {
    await removeMemberInstallation(deps.db, member.id, entry.installationId);
    throw new DomainError('org_not_found', `organization ${org} not found`);
  }
  const config = operationalConfig(installation);
  if (!config) {
    throw new DomainError(
      'org_not_configured',
      `organization ${entry.accountLogin} is not configured`,
    );
  }
  const teams = await resolveTeams(deps, installation.id, installation.accountLogin, config);
  const [first, ...rest] = teamsForMember(current.login, teams);
  if (!first) {
    throw new DomainError('not_in_team', 'you are not in any team of this organization');
  }
  return {
    member: current,
    installationId: installation.id,
    owner: installation.accountLogin,
    config,
    mine: [first, ...rest],
    date: dailyDateFor(deps.now(), first),
  };
}
