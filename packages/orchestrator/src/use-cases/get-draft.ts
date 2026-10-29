import { type ActivityItem, activitySince } from '@standwise/core';
import { getLastDaily, type MemberRow } from '@standwise/db';
import type { Deps } from '../deps';
import { type MembershipCheck, resolveOrgContext } from './org-context';

export type Draft = {
  org: string;
  date: string;
  since: string;
  teams: string[];
  activity: ActivityItem[];
  suggestions: never[];
};

export async function getDraft(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  org: string | undefined,
): Promise<Draft> {
  const ctx = await resolveOrgContext(deps, isMember, member, org);
  const cal = ctx.mine[0];
  const lastDaily = await getLastDaily(deps.db, ctx.installationId, ctx.member.id, ctx.date);
  const since = activitySince({ date: ctx.date, cal, ...(lastDaily ? { lastDaily } : {}) });
  const octokit = await deps.github.installationOctokit(ctx.installationId);
  const activity = await deps.github.listActivity(octokit, ctx.owner, ctx.member.login, since);
  return {
    org: ctx.owner,
    date: ctx.date,
    since: since.toISOString(),
    teams: ctx.mine.map((t) => t.name),
    activity,
    suggestions: [],
  };
}
