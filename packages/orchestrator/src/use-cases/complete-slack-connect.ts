import {
  deleteIdentities,
  getConnectionExternalId,
  type MemberRow,
  saveConnection,
} from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import type { Deps } from '../deps';
import { hashSessionToken, verifyState } from '../state-token';
import { DomainError } from './errors';
import type { MembershipCheck } from './org-context';
import { requireAdmin } from './require-admin';

export async function completeSlackConnect(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: {
    sessionToken: string;
    code: string | undefined;
    state: string | undefined;
    error?: string | undefined;
  },
): Promise<{ installationId: number }> {
  if (input.error === 'access_denied') {
    throw new DomainError('access_denied', 'Slack authorization was denied');
  }
  const state = input.state
    ? verifyState(deps.env.sessionSecret, input.state, 'slack', deps.now())
    : null;
  if (!state || !input.code || state.sessionHash !== hashSessionToken(input.sessionToken)) {
    throw new DomainError('invalid_state', 'invalid or expired slack connection state');
  }
  const { installation } = await requireAdmin(deps, isMember, member, state.installationId);
  const { teamId, teamName, botToken } = await deps.slack
    .exchangeCode({
      clientId: deps.env.slackClientId,
      clientSecret: deps.env.slackClientSecret,
      code: input.code,
      redirectUri: `${deps.env.publicUrl}/oauth/slack/callback`,
    })
    .catch((error: unknown) => {
      if (error instanceof ChatDeliveryError) {
        throw new DomainError('slack_oauth_failed', 'Slack authorization failed');
      }
      throw error;
    });
  const previousTeamId = await getConnectionExternalId(deps.db, installation.id, 'slack');
  if (previousTeamId !== null && previousTeamId !== teamId) {
    await deleteIdentities(deps.db, installation.id, 'slack');
  }
  await saveConnection(
    deps.db,
    installation.id,
    'slack',
    teamId,
    botToken,
    deps.encryptionKey,
    teamName,
  );
  return { installationId: installation.id };
}
