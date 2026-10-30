import type { ConfigError } from '@standwise/core';
import {
  type ApiKeySummary,
  getConnection,
  listApiKeys,
  listFailedDeliveries,
  type MemberRow,
  operationalConfig,
} from '@standwise/db';
import type { Deps } from '../deps';
import { statusOf } from '../membership';
import { authorizeInstallation } from './authorize-installation';
import { isInstallationAdmin } from './is-installation-admin';
import type { MembershipCheck } from './org-context';
import { loadWebhookOverview, type WebhookOverview } from './webhook-endpoints';

const FAILED_LIMIT = 5;

export type SetupStatus = {
  installationId: number;
  owner: string;
  login: string;
  admin: boolean;
  config:
    | { status: 'configured' }
    | { status: 'invalid'; errors: ConfigError[]; lastValid: boolean }
    | { status: 'unconfigured'; reason: string };
  accessWarning: string | null;
  configRepo: { exists: true; defaultBranch: string } | { exists: false };
  slack: { connected: false } | { connected: true; workspace: string };
  failedDeliveries: { team: string; at: Date; error: string }[];
  apiKeys: { manage: false } | { manage: true; keys: ApiKeySummary[] };
  webhooks: { manage: false } | ({ manage: true } & WebhookOverview);
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
    if (statusOf(error) === 404) return { exists: false };
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
  const [configRepo, connection, failed, admin] = await Promise.all([
    findConfigRepo(octokit, installation.accountLogin),
    getConnection(deps.db, installation.id, 'slack', deps.encryptionKey),
    listFailedDeliveries(deps.db, installation.id, FAILED_LIMIT),
    isInstallationAdmin(deps, installation.id, current).catch(() => false),
  ]);
  const [apiKeys, webhooks]: [SetupStatus['apiKeys'], SetupStatus['webhooks']] = admin
    ? await Promise.all([
        listApiKeys(deps.db, installation.id).then((keys) => ({ manage: true as const, keys })),
        loadWebhookOverview(deps.db, installation.id).then((overview) => ({
          manage: true as const,
          ...overview,
        })),
      ])
    : [{ manage: false }, { manage: false }];
  const config: SetupStatus['config'] =
    installation.status === 'configured'
      ? { status: 'configured' }
      : installation.status === 'invalid'
        ? {
            status: 'invalid',
            errors: installation.configErrors ?? [],
            lastValid: operationalConfig(installation) !== null,
          }
        : { status: 'unconfigured', reason: installation.unconfiguredReason ?? 'no_repo' };
  return {
    installationId: installation.id,
    owner: installation.accountLogin,
    login: current.login,
    admin,
    config,
    accessWarning: installation.accessWarning,
    configRepo,
    slack: connection
      ? { connected: true, workspace: connection.externalName ?? connection.externalId }
      : { connected: false },
    failedDeliveries: failed.map((d) => ({
      team: d.teamName,
      at: d.updatedAt,
      error: d.error ?? '',
    })),
    apiKeys,
    webhooks,
    supportEmail: deps.env.supportEmail,
  };
}
