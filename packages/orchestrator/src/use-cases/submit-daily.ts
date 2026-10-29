import type { DailySubmission } from '@standwise/core';
import { getDelivery, getMemberDaily, type MemberRow, upsertDaily } from '@standwise/db';
import type { Deps } from '../deps';
import { newBlockers } from '../events';
import { emitEventSafely } from './emit-event';
import { type MembershipCheck, type OrgContext, resolveOrgContext } from './org-context';

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

export async function submitDaily(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  payload: DailySubmission,
): Promise<SubmitDailyResult> {
  const ctx = await resolveOrgContext(deps, isMember, member, payload.org);
  const previous = await getMemberDaily(deps.db, ctx.installationId, ctx.member.id, ctx.date);
  const { id } = await upsertDaily(deps.db, {
    installationId: ctx.installationId,
    memberId: ctx.member.id,
    date: ctx.date,
    payload,
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
  await emitDailyEvents(deps, ctx, {
    id,
    teams,
    payload,
    previous: previous?.payload ?? null,
  });
  return { date: ctx.date, teams, late };
}

async function emitDailyEvents(
  deps: Deps,
  ctx: OrgContext,
  p: { id: string; teams: string[]; payload: DailySubmission; previous: DailySubmission | null },
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
  for (const blocker of newBlockers(p.previous?.blockers, p.payload.blockers)) {
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
