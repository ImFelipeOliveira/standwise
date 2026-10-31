import type { Weekday } from '@standwise/core';
import type { Deps } from '../deps';
import { loadOrgTeams } from './org-teams';

export type OrgTeam = {
  name: string;
  timezone: string;
  workdays: Weekday[];
  remindAt: string;
  digestAt: string;
  memberLogins: string[];
};

export async function listOrgTeams(deps: Deps, installationId: number): Promise<OrgTeam[]> {
  const { teams } = await loadOrgTeams(deps, installationId);
  return teams.map((t) => ({
    name: t.name,
    timezone: t.timezone,
    workdays: t.workdays,
    remindAt: t.remindAt,
    digestAt: t.digestAt,
    memberLogins: t.memberLogins,
  }));
}
