import type { DailyConfirmation, DailySubmission, Item } from '@standcast/core';
import {
  confirmSuggestionsByUrl,
  getDelivery,
  getMemberDaily,
  type MemberRow,
  upsertDaily,
} from '@standcast/db';
import type { Deps } from '../deps';
import { blockerRouteId, newBlockers, newRoutedBlockers } from '../events';
import { logError } from '../log-error';
import { emitEventSafely } from './emit-event';
import { type MembershipCheck, type OrgContext, resolveOrgContext } from './org-context';
import { ROUTE_BLOCKER_JOB, type RouteBlockerJob } from './route-blocker';

export type SubmitDailyResult = { date: string; teams: string[]; late: boolean };

async function isLate(deps: Deps, ctx: OrgContext): Promise<boolean> {
  for (const team of ctx.mine) {
    const delivery = await getDelivery(deps.db, {
      installationId: ctx.installationId,
      teamName: team.name,
      date: ctx.date,
      kind: 'digest',
    });
    if (delivery?.status === 'sent') return true;
  }
  return false;
}

async function confirmBlockerSuggestions(
  deps: Deps,
  ctx: OrgContext,
  blockers: Item[],
): Promise<void> {
  const urls = [...new Set(blockers.flatMap((b) => (b.ref ? [b.ref.url] : [])))];
  if (urls.length === 0) return;
  try {
    await confirmSuggestionsByUrl(deps.db, ctx.installationId, ctx.member.id, urls);
  } catch (error) {
    logError('suggestion confirmation failed', error);
  }
}

async function enqueueBlockerRoutes(
  deps: Deps,
  installationId: number,
  dailyId: string,
  blockers: Item[],
  fresh: Item[],
): Promise<void> {
  for (const blocker of fresh) {
    const blockerId = blockerRouteId(blocker);
    const job: RouteBlockerJob = {
      installationId,
      dailyId,
      blockerIndex: blockers.indexOf(blocker),
      blockerId,
    };
    try {
      await deps.queue.enqueue(ROUTE_BLOCKER_JOB, job, {
        singletonKey: `route:${dailyId}:${blockerId}`,
      });
    } catch (error) {
      logError('blocker route enqueue failed', error);
    }
  }
}

export async function submitDaily(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  payload: DailySubmission,
  options: { confirmation?: DailyConfirmation } = {},
): Promise<SubmitDailyResult> {
  const ctx = await resolveOrgContext(deps, isMember, member, payload.org);
  const previous = await getMemberDaily(deps.db, ctx.installationId, ctx.member.id, ctx.date);
  const { id } = await upsertDaily(deps.db, {
    installationId: ctx.installationId,
    memberId: ctx.member.id,
    date: ctx.date,
    payload: options.confirmation ? { ...payload, confirmation: options.confirmation } : payload,
    submittedAt: deps.now(),
  });
  await confirmBlockerSuggestions(deps, ctx, payload.blockers);
  const teams = ctx.mine.map((t) => t.name);
  const late = await isLate(deps, ctx);
  if (late) {
    await deps.queue.enqueue('send-late-daily', {
      installationId: ctx.installationId,
      memberId: ctx.member.id,
      date: ctx.date,
    });
  }
  const fresh = newBlockers(previous?.payload.blockers, payload.blockers);
  await enqueueBlockerRoutes(
    deps,
    ctx.installationId,
    id,
    payload.blockers,
    newRoutedBlockers(previous?.payload.blockers, payload.blockers),
  );
  await emitDailyEvents(deps, ctx, {
    id,
    teams,
    payload,
    previous: previous?.payload ?? null,
    fresh,
  });
  return { date: ctx.date, teams, late };
}

async function emitDailyEvents(
  deps: Deps,
  ctx: OrgContext,
  p: {
    id: string;
    teams: string[];
    payload: DailySubmission;
    previous: DailySubmission | null;
    fresh: Item[];
  },
): Promise<void> {
  const login = ctx.member.login;
  await emitEventSafely(deps, ctx.installationId, {
    type: 'daily.submitted',
    data: {
      id: p.id,
      login,
      date: ctx.date,
      teams: p.teams,
      yesterday: p.payload.yesterday,
      today: p.payload.today,
      blockers: p.payload.blockers,
      replaced: p.previous !== null,
    },
  });
  for (const blocker of p.fresh) {
    await emitEventSafely(deps, ctx.installationId, {
      type: 'blocker.opened',
      data: {
        dailyId: p.id,
        login,
        date: ctx.date,
        text: blocker.text,
        ...(blocker.ref ? { ref: blocker.ref } : {}),
        teams: p.teams,
      },
    });
  }
}
