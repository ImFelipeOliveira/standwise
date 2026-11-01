import type { MemberRow } from '@standcast/db';
import { slackAuthorizeUrl } from '@standcast/slack';
import type { Deps } from '../deps';
import { hashSessionToken, signState } from '../state-token';
import type { MembershipCheck } from './org-context';
import { requireAdmin } from './require-admin';

export async function startSlackConnect(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: { sessionToken: string; installationId: number | undefined },
): Promise<{ url: string }> {
  const { installation } = await requireAdmin(deps, isMember, member, input.installationId);
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
