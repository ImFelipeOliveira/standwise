import {
  buildSuggestionDm,
  localDate,
  type Message,
  type StandwiseConfig,
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
import { chatUserIdFor, forgetStaleChatIdentity } from '../chat-identity';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';
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

function suggestionDm(suggestion: SuggestionRow, team: TeamConfig): Message {
  const base = { lang: team.language, ref: suggestion.ref };
  if (suggestion.kind === 'card_stale') {
    return buildSuggestionDm({ ...base, kind: 'card_stale', days: team.signals.cardStaleDays });
  }
  const hours = suggestion.kind === 'ci_failing' ? CI_FAILING_HOURS : team.signals.prReviewHours;
  return buildSuggestionDm({ ...base, kind: suggestion.kind, hours });
}

export async function notifySuggestions(
  deps: WorkerDeps,
  input: NotifySuggestionsInput,
): Promise<void> {
  const login = input.login.toLowerCase();
  const date = localDate(deps.now(), input.team.timezone);
  for (const suggestion of input.suggestions) {
    const key: DeliveryKey = {
      installationId: input.installationId,
      teamName: '',
      date,
      kind: 'suggestion_dm',
      subject: `${input.memberId}:${suggestion.fingerprint}`,
    };
    const claim = await claimDelivery(deps.db, key);
    if (claim.status !== 'claimed') continue;
    let chatUserId: string | null = null;
    try {
      const chat = await deps.chatFor(input.installationId, 'slack');
      if (!chat) {
        await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
        continue;
      }
      chatUserId = await chatUserIdFor(deps, input.installationId, input.config, login);
      if (!chatUserId) {
        await failDelivery(deps.db, key, claim.token, 'no_chat_identity');
        continue;
      }
      const ref = await chat.sendDirect(chatUserId, suggestionDm(suggestion, input.team));
      await completeDelivery(deps.db, key, claim.token, ref);
      await markSuggestionNotified(deps.db, suggestion.id);
    } catch (error) {
      await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
      logError('suggestion dm failed', error);
      if (chatUserId) {
        await forgetStaleChatIdentity(
          deps,
          input.installationId,
          input.config,
          login,
          chatUserId,
          error,
        );
      }
    }
  }
}
