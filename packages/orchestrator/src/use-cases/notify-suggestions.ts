import {
  buildSuggestionDm,
  localDate,
  type StandwiseConfig,
  type SuggestionDmKind,
  type TeamConfig,
} from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  type DeliveryKey,
  failDelivery,
  markSuggestionNotified,
  type SuggestionRow,
} from '@standwise/db';
import { chatUserIdFor } from '../chat-identity';
import type { WorkerDeps } from '../deps';
import { describeDeliveryError } from './delivery-error';

export const CI_FAILING_HOURS = 24;

export type NotifySuggestionsInput = {
  installationId: number;
  config: StandwiseConfig;
  memberId: string;
  login: string;
  team: TeamConfig;
  suggestions: SuggestionRow[];
};

function hoursFor(kind: SuggestionDmKind, team: TeamConfig): number {
  return kind === 'ci_failing' ? CI_FAILING_HOURS : team.signals.prReviewHours;
}

function logSendFailure(error: unknown): void {
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  console.error('suggestion dm failed', {
    name: String(e.name),
    code: String(e.code),
    message: String(e.message),
  });
}

export async function notifySuggestions(
  deps: WorkerDeps,
  input: NotifySuggestionsInput,
): Promise<void> {
  const login = input.login.toLowerCase();
  const date = localDate(deps.now(), input.team.timezone);
  for (const suggestion of input.suggestions) {
    if (suggestion.kind !== 'pr_no_review' && suggestion.kind !== 'ci_failing') continue;
    const key: DeliveryKey = {
      installationId: input.installationId,
      teamName: '',
      date,
      kind: 'suggestion_dm',
      subject: `${input.memberId}:${suggestion.fingerprint}`,
    };
    const claim = await claimDelivery(deps.db, key);
    if (claim.status !== 'claimed') continue;
    try {
      const chat = await deps.chatFor(input.installationId, 'slack');
      if (!chat) {
        await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
        continue;
      }
      const chatUserId = await chatUserIdFor(deps, input.installationId, input.config, login);
      if (!chatUserId) {
        await failDelivery(deps.db, key, claim.token, 'no_chat_identity');
        continue;
      }
      const ref = await chat.sendDirect(
        chatUserId,
        buildSuggestionDm({
          lang: input.team.language,
          kind: suggestion.kind,
          ref: suggestion.ref,
          hours: hoursFor(suggestion.kind, input.team),
        }),
      );
      await completeDelivery(deps.db, key, claim.token, ref);
      await markSuggestionNotified(deps.db, suggestion.id);
    } catch (error) {
      await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
      logSendFailure(error);
    }
  }
}
