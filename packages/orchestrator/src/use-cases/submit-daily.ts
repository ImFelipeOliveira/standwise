import type { DailyConfirmation, DailySubmission, Item } from '@standwise/core';
import { getDelivery, getMemberDaily, type MemberRow, upsertDaily } from '@standwise/db';
import type { Deps } from '../deps';
import { blockerHash, newBlockers } from '../events';
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

async function enqueueBlockerRoutes(
  deps: Deps,
  installationId: number,
  dailyId: string,
  blockers: Item[],
  fresh: Item[],
): Promise<void> {
  for (const blocker of fresh) {
    const hash = blockerHash(blocker);
    const job: RouteBlockerJob = {
      installationId,
      dailyId,
      blockerIndex: blockers.indexOf(blocker),
      blockerHash: hash,
    };
    try {
      await deps.queue.enqueue(ROUTE_BLOCKER_JOB, job, {
        singletonKey: `route:${dailyId}:${hash}`,
      });
    } catch (error) {
      const e = error as { name?: unknown; code?: unknown; message?: unknown };
      console.error('blocker route enqueue failed', {
        name: String(e.name),
        code: String(e.code),
        message: String(e.message),
      });
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
  await enqueueBlockerRoutes(deps, ctx.installationId, id, payload.blockers, fresh);
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
