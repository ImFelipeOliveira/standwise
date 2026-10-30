import { memberOverrides, type StandwiseConfig } from '@standwise/core';
import { getIdentities } from '@standwise/db';
import type { Deps } from './deps';

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
