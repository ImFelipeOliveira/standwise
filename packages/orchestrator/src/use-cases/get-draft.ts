import {
  type ActivityItem,
  activitySince,
  clampTitle,
  type Ref,
  type SignalKind,
} from '@standwise/core';
import { getLastDaily, listPendingSuggestions, type MemberRow } from '@standwise/db';
import type { Deps } from '../deps';
import { logError } from '../log-error';
import { type MembershipCheck, type OrgContext, resolveOrgContext } from './org-context';

const MAX_ACTIVITY = 50;

export type DraftSuggestion = { id: string; kind: SignalKind; ref: Ref; since: string };

export type Draft = {
  org: string;
  date: string;
  since: string;
  teams: string[];
  activity: ActivityItem[];
  suggestions: DraftSuggestion[];
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
  const github = await deps.github.listActivity(octokit, ctx.owner, ctx.member.login, since);
  const cards = await listCards(deps, ctx, since);
  const activity = [...github, ...cards]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_ACTIVITY);
  const pending = await listPendingSuggestions(deps.db, ctx.installationId, ctx.member.id);
  return {
    org: ctx.owner,
    date: ctx.date,
    since: since.toISOString(),
    teams: ctx.mine.map((t) => t.name),
    activity,
    suggestions: pending.map((s) => ({
      id: s.id,
      kind: s.kind,
      ref: s.ref.title === undefined ? s.ref : { ...s.ref, title: clampTitle(s.ref.title) },
      since: s.createdAt.toISOString(),
    })),
  };
}

async function listCards(deps: Deps, ctx: OrgContext, since: Date): Promise<ActivityItem[]> {
  try {
    const tracker = await deps.trackerFor(ctx.installationId, ctx.owner, ctx.config, ctx.mine[0]);
    if (!tracker.connected) return [];
    const items = await tracker.listActivity(ctx.member.login, since);
    return items.map((item) => ({ ...item, title: clampTitle(item.title) }));
  } catch (error) {
    logError('draft card activity failed', error, { installationId: String(ctx.installationId) });
    return [];
  }
}
