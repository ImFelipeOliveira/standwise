import { dailyDateFor, type ResolvedTeam, teamsForMember } from '@standwise/core';
import {
  getInstallation,
  listMemberInstallations,
  type MemberRow,
  removeMemberInstallation,
} from '@standwise/db';
import type { Deps } from '../deps';
import type { createMembershipCheck } from '../membership';
import { resolveTeams } from '../teams';
import { DomainError } from './errors';

export type OrgContext = {
  installationId: number;
  owner: string;
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
  if (!installation || !(await isMember(installation, member))) {
    await removeMemberInstallation(deps.db, member.id, entry.installationId);
    throw new DomainError('org_not_found', `organization ${org} not found`);
  }
  if (installation.status !== 'configured' || !installation.config) {
    throw new DomainError(
      'org_not_configured',
      `organization ${entry.accountLogin} is not configured`,
    );
  }
  const teams = await resolveTeams(
    deps,
    installation.id,
    installation.accountLogin,
    installation.config,
  );
  const [first, ...rest] = teamsForMember(member.login, teams);
  if (!first) {
    throw new DomainError('not_in_team', 'you are not in any team of this organization');
  }
  return {
    installationId: installation.id,
    owner: installation.accountLogin,
    mine: [first, ...rest],
    date: dailyDateFor(deps.now(), first),
  };
}
