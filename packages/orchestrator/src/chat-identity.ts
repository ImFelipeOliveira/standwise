import { memberOverrides, type StandwiseConfig } from '@standwise/core';
import { getIdentities } from '@standwise/db';
import type { Deps } from './deps';

export async function chatUserIdFor(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  config: StandwiseConfig,
  login: string,
): Promise<string | null> {
  const override = memberOverrides(config, login).slack;
  if (override) return override;
  const identities = await getIdentities(deps.db, installationId, 'slack');
  return identities.get(login.toLowerCase()) ?? null;
}
