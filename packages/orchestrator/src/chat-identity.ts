import { memberOverrides, type StandwiseConfig } from '@standwise/core';
import { deleteIdentityByLogin, getIdentities } from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import type { Deps } from './deps';
import { logError } from './log-error';

export async function chatUserIdsFor(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  config: StandwiseConfig,
  logins: string[],
): Promise<Map<string, string>> {
  const identities = await getIdentities(deps.db, installationId, 'slack');
  const ids = new Map<string, string>();
  for (const login of logins) {
    const lower = login.toLowerCase();
    const id = memberOverrides(config, lower).slack ?? identities.get(lower);
    if (id) ids.set(lower, id);
  }
  return ids;
}

export async function chatUserIdFor(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  config: StandwiseConfig,
  login: string,
): Promise<string | null> {
  const ids = await chatUserIdsFor(deps, installationId, config, [login]);
  return ids.get(login.toLowerCase()) ?? null;
}

const STALE_CHAT_USER = new Set(['user_not_found', 'user_disabled']);

export async function forgetChatIdentity(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  memberLogin: string,
  externalId: string,
): Promise<void> {
  await deleteIdentityByLogin(deps.db, installationId, 'slack', memberLogin, externalId);
}

export async function forgetStaleChatIdentity(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  config: StandwiseConfig,
  memberLogin: string,
  externalId: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof ChatDeliveryError) || !STALE_CHAT_USER.has(error.code)) return;
  if (memberOverrides(config, memberLogin.toLowerCase()).slack !== undefined) return;
  try {
    await forgetChatIdentity(deps, installationId, memberLogin, externalId);
  } catch (cause) {
    logError('chat identity cleanup failed', cause, { installationId: String(installationId) });
  }
}
