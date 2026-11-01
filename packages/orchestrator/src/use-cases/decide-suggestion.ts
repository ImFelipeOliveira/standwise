import { decideSuggestion, type MemberRow } from '@standcast/db';
import type { Deps } from '../deps';
import { DomainError } from './errors';
import { type MembershipCheck, resolveOrgContext } from './org-context';
import { isUuid } from './pagination';

export type SuggestionDecision = 'confirmed' | 'ignored';

export async function decideDraftSuggestion(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  org: string | undefined,
  id: string,
  decision: SuggestionDecision,
): Promise<void> {
  const ctx = await resolveOrgContext(deps, isMember, member, org);
  const result = isUuid(id)
    ? await decideSuggestion(deps.db, ctx.installationId, ctx.member.id, id, decision)
    : 'not_found';
  if (result === 'not_found') throw new DomainError('not_found', 'suggestion not found');
  if (result === 'conflict') {
    throw new DomainError('suggestion_already_decided', 'suggestion was already decided');
  }
}
