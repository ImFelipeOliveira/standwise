import type { DailySubmission } from '@standwise/core';
import { getDelivery, type MemberRow, upsertDaily } from '@standwise/db';
import type { Deps } from '../deps';
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
  await upsertDaily(deps.db, {
    installationId: ctx.installationId,
    memberId: member.id,
    date: ctx.date,
    payload,
    submittedAt: deps.now(),
  });
  const late = await isLate(deps, ctx);
  if (late) {
    await deps.queue.enqueue('send-late-daily', {
      installationId: ctx.installationId,
      memberId: member.id,
      date: ctx.date,
    });
  }
  return { date: ctx.date, teams: ctx.mine.map((t) => t.name), late };
}
