import { type MemberRow, saveConnection } from '@standwise/db';
import type { Deps } from '../deps';
import { hashSessionToken, verifyState } from '../state-token';
import { authorizeInstallation } from './authorize-installation';
import { DomainError } from './errors';
import type { MembershipCheck } from './org-context';

export async function completeSlackConnect(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: { sessionToken: string; code: string | undefined; state: string | undefined },
): Promise<{ installationId: number }> {
  const state = input.state
    ? verifyState(deps.env.sessionSecret, input.state, 'slack', deps.now())
    : null;
  if (!state || !input.code || state.sessionHash !== hashSessionToken(input.sessionToken)) {
    throw new DomainError('invalid_state', 'invalid or expired slack connection state');
  }
  const { installation } = await authorizeInstallation(
    deps,
    isMember,
    member,
    state.installationId,
  );
  const { teamId, botToken } = await deps.slack.exchangeCode({
    clientId: deps.env.slackClientId,
    clientSecret: deps.env.slackClientSecret,
    code: input.code,
    redirectUri: `${deps.env.publicUrl}/oauth/slack/callback`,
  });
  await saveConnection(deps.db, installation.id, 'slack', teamId, botToken, deps.encryptionKey);
  return { installationId: installation.id };
}
