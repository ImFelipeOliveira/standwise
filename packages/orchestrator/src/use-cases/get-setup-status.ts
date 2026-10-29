import type { ConfigError } from '@standwise/core';
import { getConnection, listFailedDeliveries, type MemberRow } from '@standwise/db';
import type { Deps } from '../deps';
import { authorizeInstallation } from './authorize-installation';
import type { MembershipCheck } from './org-context';

const FAILED_LIMIT = 5;

export type SetupStatus = {
  installationId: number;
  owner: string;
  login: string;
  config:
    | { status: 'configured' }
    | { status: 'invalid'; errors: ConfigError[] }
    | { status: 'unconfigured'; reason: string };
  configRepo: { exists: true; defaultBranch: string } | { exists: false };
  slack: { connected: false } | { connected: true; workspace: string };
  failedDeliveries: { team: string; at: Date; error: string }[];
  supportEmail: string;
};

type Octokit = Awaited<ReturnType<Deps['github']['installationOctokit']>>;

async function findConfigRepo(octokit: Octokit, owner: string): Promise<SetupStatus['configRepo']> {
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}', {
      owner,
      repo: '.github',
    });
    return { exists: true, defaultBranch: response.data.default_branch || 'main' };
  } catch (error) {
    if ((error as { status?: unknown } | null)?.status === 404) return { exists: false };
    throw error;
  }
}

export async function getSetupStatus(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number | undefined,
): Promise<SetupStatus> {
  const { member: current, installation } = await authorizeInstallation(
    deps,
    isMember,
    member,
    installationId,
  );
  const octokit = await deps.github.installationOctokit(installation.id);
  const [configRepo, connection, failed] = await Promise.all([
    findConfigRepo(octokit, installation.accountLogin),
    getConnection(deps.db, installation.id, 'slack', deps.encryptionKey),
    listFailedDeliveries(deps.db, installation.id, FAILED_LIMIT),
  ]);
  const config: SetupStatus['config'] =
    installation.status === 'configured'
      ? { status: 'configured' }
      : installation.status === 'invalid'
        ? { status: 'invalid', errors: installation.configErrors ?? [] }
        : { status: 'unconfigured', reason: installation.unconfiguredReason ?? 'no_repo' };
  return {
    installationId: installation.id,
    owner: installation.accountLogin,
    login: current.login,
    config,
    configRepo,
    slack: connection
      ? { connected: true, workspace: connection.externalName ?? connection.externalId }
      : { connected: false },
    failedDeliveries: failed.map((d) => ({
      team: d.teamName,
      at: d.updatedAt,
      error: d.error ?? '',
    })),
    supportEmail: deps.env.supportEmail,
  };
}
