import { parseConfig } from '@standwise/core';
import {
  getInstallation,
  setInstallationAccessWarning,
  setInstallationConfig,
} from '@standwise/db';
import type { Deps } from '../deps';
import { invalidateResolvedTeams } from '../teams';

export type ConfigStatus = 'configured' | 'invalid' | 'unconfigured';

export const LOAD_CONFIG_JOB = 'load-config';

export type LoadConfigJob = { installationId: number; owner: string };

type ConfigDeps = Pick<Deps, 'db' | 'github'>;

export async function enqueueLoadConfig(
  deps: Pick<Deps, 'queue'>,
  job: LoadConfigJob,
): Promise<void> {
  await deps.queue.enqueue(LOAD_CONFIG_JOB, job, {
    singletonKey: `load-config:${job.installationId}`,
    policy: 'stately',
  });
}

export async function loadConfig(deps: ConfigDeps, job: LoadConfigJob): Promise<void> {
  const installation = await getInstallation(deps.db, job.installationId);
  if (!installation) return;
  if (installation.accountLogin.toLowerCase() !== job.owner.toLowerCase()) return;
  await loadInstallationConfig(deps, installation.id, installation.accountLogin);
}

export async function loadInstallationConfig(
  deps: ConfigDeps,
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
  deps: ConfigDeps,
  installationId: number,
  state: Parameters<typeof setInstallationConfig>[2],
): Promise<void> {
  await setInstallationConfig(deps.db, installationId, state);
  invalidateResolvedTeams(deps, installationId);
}
