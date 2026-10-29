import type { MemberRow } from '@standwise/db';
import { slackAuthorizeUrl } from '@standwise/slack';
import type { Deps } from '../deps';
import { hashSessionToken, signState } from '../state-token';
import { authorizeInstallation } from './authorize-installation';
import type { MembershipCheck } from './org-context';

export async function startSlackConnect(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: { sessionToken: string; installationId: number | undefined },
): Promise<{ url: string }> {
  const { installation } = await authorizeInstallation(
    deps,
    isMember,
    member,
    input.installationId,
  );
  const state = signState(
    deps.env.sessionSecret,
    {
      kind: 'slack',
      installationId: installation.id,
      sessionHash: hashSessionToken(input.sessionToken),
    },
    deps.now(),
  );
  return {
    url: slackAuthorizeUrl({
      clientId: deps.env.slackClientId,
      redirectUri: `${deps.env.publicUrl}/oauth/slack/callback`,
      state,
    }),
  };
}
