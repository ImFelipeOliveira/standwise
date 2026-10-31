import type { MemberRow } from '@standwise/db';
import { linearAuthorizeUrl } from '@standwise/linear';
import type { Deps } from '../deps';
import { hashSessionToken, signState } from '../state-token';
import type { MembershipCheck } from './org-context';
import { requireAdmin } from './require-admin';

export const linearRedirectUri = (deps: Pick<Deps, 'env'>) =>
  `${deps.env.publicUrl}/oauth/linear/callback`;

export async function startLinearConnect(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: { sessionToken: string; installationId: number | undefined },
): Promise<{ url: string }> {
  const { installation } = await requireAdmin(deps, isMember, member, input.installationId);
  const state = signState(
    deps.env.sessionSecret,
    {
      kind: 'linear',
      installationId: installation.id,
      sessionHash: hashSessionToken(input.sessionToken),
    },
    deps.now(),
  );
  return {
    url: linearAuthorizeUrl({
      clientId: deps.env.linearClientId,
      redirectUri: linearRedirectUri(deps),
      state,
    }),
  };
}
