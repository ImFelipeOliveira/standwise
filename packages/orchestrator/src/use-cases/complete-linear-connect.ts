import {
  deleteIdentities,
  getConnectionExternalId,
  type MemberRow,
  saveConnection,
} from '@standwise/db';
import {
  createLinearClient,
  getOrganization,
  type LinearOrganization,
  type LinearTokens,
} from '@standwise/linear';
import type { Deps } from '../deps';
import { logError } from '../log-error';
import { hashSessionToken, verifyState } from '../state-token';
import { DomainError } from './errors';
import type { MembershipCheck } from './org-context';
import { requireAdmin } from './require-admin';
import { linearRedirectUri } from './start-linear-connect';

async function authorize(
  deps: Deps,
  code: string,
): Promise<{ tokens: LinearTokens; organization: LinearOrganization }> {
  const tokens = await deps.linear.exchangeCode(
    {
      clientId: deps.env.linearClientId,
      clientSecret: deps.env.linearClientSecret,
      code,
      redirectUri: linearRedirectUri(deps),
    },
    deps.linear.fetch,
  );
  const organization = await getOrganization(
    createLinearClient(tokens.accessToken, deps.linear.fetch),
  );
  return { tokens, organization };
}

export async function completeLinearConnect(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: { sessionToken: string; code?: string; state?: string; error?: string },
): Promise<{ installationId: number }> {
  if (input.error === 'access_denied') {
    throw new DomainError('access_denied', 'Linear authorization was denied');
  }
  const state = input.state
    ? verifyState(deps.env.sessionSecret, input.state, 'linear', deps.now())
    : null;
  if (!state || !input.code || state.sessionHash !== hashSessionToken(input.sessionToken)) {
    throw new DomainError('invalid_state', 'invalid or expired linear connection state');
  }
  const { installation } = await requireAdmin(deps, isMember, member, state.installationId);
  const { tokens, organization } = await authorize(deps, input.code).catch((error: unknown) => {
    logError('linear connect failed', error, { installationId: String(installation.id) });
    throw new DomainError('linear_oauth_failed', 'Linear authorization failed');
  });
  const previousOrganizationId = await getConnectionExternalId(deps.db, installation.id, 'linear');
  if (previousOrganizationId !== null && previousOrganizationId !== organization.id) {
    await deleteIdentities(deps.db, installation.id, 'linear');
  }
  await saveConnection(
    deps.db,
    installation.id,
    'linear',
    organization.id,
    JSON.stringify(tokens),
    deps.encryptionKey,
    organization.name,
    organization.urlKey,
  );
  return { installationId: installation.id };
}
