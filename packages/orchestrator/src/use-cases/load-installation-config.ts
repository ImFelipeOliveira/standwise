import { parseConfig } from '@standwise/core';
import {
  getInstallation,
  setInstallationAccessWarning,
  setInstallationConfig,
} from '@standwise/db';
import type { Deps } from '../deps';
import { invalidateResolvedTeams } from '../teams';

export type ConfigStatus = 'configured' | 'invalid' | 'unconfigured';

export async function loadInstallationConfig(
  deps: Deps,
  installationId: number,
  owner: string,
): Promise<ConfigStatus> {
  const octokit = await deps.github.installationOctokit(installationId);
  const source = await deps.github.fetchConfigSource(octokit, owner);
  if (!source.found && source.reason === 'no_access') {
    const current = await getInstallation(deps.db, installationId);
    if (current && current.status !== 'unconfigured') {
      await setInstallationAccessWarning(deps.db, installationId, source.reason);
      return current.status;
    }
  }
  if (!source.found) {
    await storeConfig(deps, installationId, { status: 'unconfigured', reason: source.reason });
    return 'unconfigured';
  }
  const parsed = parseConfig(source.source);
  if (!parsed.ok) {
    await storeConfig(deps, installationId, { status: 'invalid', errors: parsed.errors });
    return 'invalid';
  }
  await storeConfig(deps, installationId, { status: 'configured', config: parsed.config });
  return 'configured';
}

async function storeConfig(
  deps: Deps,
  installationId: number,
  state: Parameters<typeof setInstallationConfig>[2],
): Promise<void> {
  await setInstallationConfig(deps.db, installationId, state);
  invalidateResolvedTeams(deps, installationId);
}
