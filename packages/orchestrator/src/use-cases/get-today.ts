import type { MemberRow } from '@standcast/db';
import type { Deps } from '../deps';
import { type MembershipCheck, resolveOrgContext } from './org-context';

export type Today = { org: string; date: string; teams: string[] };

export async function getToday(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  org: string | undefined,
): Promise<Today> {
  const ctx = await resolveOrgContext(deps, isMember, member, org);
  return { org: ctx.owner, date: ctx.date, teams: ctx.mine.map((t) => t.name) };
}
