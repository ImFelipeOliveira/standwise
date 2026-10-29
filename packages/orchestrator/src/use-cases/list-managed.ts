import { addCalendarDays, localDate } from '@standwise/core';
import { listMemberInstallations, type MemberRow } from '@standwise/db';
import type { Deps } from '../deps';
import { authorizeInstallation } from './authorize-installation';
import { readableTeams } from './can-read-team';
import { DomainError } from './errors';
import { listOrgBlockers, type OrgBlocker } from './list-org-blockers';
import { listOrgDailies, type OrgDaily } from './list-org-dailies';
import { listOrgDigests, type OrgDigest } from './list-org-digests';
import { listOrgTeams, type OrgTeam } from './list-org-teams';
import type { MembershipCheck } from './org-context';
import { type Page, parseDay } from './pagination';

export const HISTORY_DAYS = 90;

export type ManagedQuery = {
  org?: string;
  team?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

type ManagedOrg = { member: MemberRow; installationId: number };
type ManagedTeam = {
  installationId: number;
  readable: Set<string>;
  scope: { team: string; from: string; to: string };
};

async function resolveManagedOrg(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  org: string | undefined,
): Promise<ManagedOrg> {
  if (!org) throw new DomainError('invalid_request', 'org is required');
  const wanted = org.toLowerCase();
  const entry = (await listMemberInstallations(deps.db, member.id)).find(
    (i) => i.accountLogin.toLowerCase() === wanted,
  );
  if (!entry) throw new DomainError('org_not_found', `organization ${org} not found`);
  const authorized = await authorizeInstallation(deps, isMember, member, entry.installationId);
  return { member: authorized.member, installationId: entry.installationId };
}

function historyRange(deps: Deps, timezone: string, query: ManagedQuery) {
  const today = localDate(deps.now(), timezone);
  const earliest = addCalendarDays(today, -(HISTORY_DAYS - 1));
  const from = parseDay(query.from, 'from') ?? earliest;
  const to = parseDay(query.to, 'to') ?? today;
  if (from > to) throw new DomainError('invalid_request', 'from must not be after to');
  if (from < earliest || to > today) {
    throw new DomainError(
      'invalid_request',
      `history is limited to the last ${HISTORY_DAYS} days, from ${earliest} to ${today}`,
    );
  }
  return { from, to };
}

async function resolveManagedTeam(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  query: ManagedQuery,
): Promise<ManagedTeam> {
  const { member: current, installationId } = await resolveManagedOrg(
    deps,
    isMember,
    member,
    query.org,
  );
  const team = query.team;
  if (!team) throw new DomainError('invalid_request', 'team is required');
  const teams = await readableTeams(deps, installationId, current);
  const config = teams.find((t) => t.name === team);
  if (!config) throw new DomainError('forbidden', 'you cannot read this team');
  return {
    installationId,
    readable: new Set(teams.map((t) => t.name)),
    scope: { team, ...historyRange(deps, config.timezone, query) },
  };
}

export async function listManagedTeams(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  org: string | undefined,
): Promise<OrgTeam[]> {
  const { member: current, installationId } = await resolveManagedOrg(deps, isMember, member, org);
  const readable = new Set(
    (await readableTeams(deps, installationId, current)).map((team) => team.name),
  );
  return (await listOrgTeams(deps, installationId)).filter((team) => readable.has(team.name));
}

function scopeTeams<T extends { teams: string[] }>(page: Page<T>, readable: Set<string>): Page<T> {
  return {
    ...page,
    data: page.data.map((row) => ({ ...row, teams: row.teams.filter((t) => readable.has(t)) })),
  };
}

export async function listManagedDigests(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  query: ManagedQuery,
): Promise<Page<OrgDigest>> {
  const { installationId, scope } = await resolveManagedTeam(deps, isMember, member, query);
  return listOrgDigests(deps, installationId, {
    ...scope,
    cursor: query.cursor,
    limit: query.limit,
  });
}

export async function listManagedDailies(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  query: ManagedQuery,
): Promise<Page<OrgDaily>> {
  const { installationId, readable, scope } = await resolveManagedTeam(
    deps,
    isMember,
    member,
    query,
  );
  const page = await listOrgDailies(deps, installationId, {
    ...scope,
    cursor: query.cursor,
    limit: query.limit,
  });
  return scopeTeams(page, readable);
}

export async function listManagedBlockers(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  query: ManagedQuery,
): Promise<Page<OrgBlocker>> {
  const { installationId, readable, scope } = await resolveManagedTeam(
    deps,
    isMember,
    member,
    query,
  );
  const page = await listOrgBlockers(deps, installationId, {
    ...scope,
    cursor: query.cursor,
    limit: query.limit,
  });
  return scopeTeams(page, readable);
}
