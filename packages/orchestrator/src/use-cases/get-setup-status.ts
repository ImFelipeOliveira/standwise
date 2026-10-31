import type { ConfigError, StandwiseConfig } from '@standwise/core';
import {
  type ApiKeySummary,
  getConnection,
  getConnectionInfo,
  listApiKeys,
  listFailedPersonDeliveryGroups,
  listFailedTeamDeliveries,
  type MemberRow,
  operationalConfig,
  type PersonFailureGroup,
  type TeamFailure,
} from '@standwise/db';
import type { Deps } from '../deps';
import { logError } from '../log-error';
import { statusOf } from '../membership';
import { type TeamNotice, teamResolutionNotices } from '../teams';
import { authorizeInstallation } from './authorize-installation';
import { isInstallationAdmin } from './is-installation-admin';
import type { MembershipCheck } from './org-context';
import { loadWebhookOverview, type WebhookOverview } from './webhook-endpoints';

const TEAM_FAILURE_LIMIT = 5;
const PERSON_FAILURE_GROUP_LIMIT = 10;
const TEAM_NOTICES_TIMEOUT_MS = 3000;

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
  linear:
    | { connected: false }
    | { connected: true; workspace: string; urlKey: string; invalid: boolean };
  trackerNotices: TrackerNotice[];
  teamNotices: TeamNotice[];
  teamFailures: TeamFailure[];
  personFailures: PersonFailureGroup[];
  apiKeys: { manage: false } | { manage: true; keys: ApiKeySummary[] };
  webhooks: { manage: false } | ({ manage: true } & WebhookOverview);
  supportEmail: string;
};

export type TrackerNotice = 'linear_not_connected' | 'jira_coming_soon';

function trackerNotices(
  config: StandwiseConfig | null,
  linear: SetupStatus['linear'],
): TrackerNotice[] {
  const providers = new Set(config?.teams.map((team) => team.tracker?.provider) ?? []);
  const notices: TrackerNotice[] = [];
  if (providers.has('linear') && !linear.connected) notices.push('linear_not_connected');
  if (providers.has('jira')) notices.push('jira_coming_soon');
  return notices;
}

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

async function safeTeamNotices(
  deps: Deps,
  installationId: number,
  owner: string,
  config: StandwiseConfig | null,
): Promise<TeamNotice[]> {
  if (!config) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TeamNotice[]>((resolve) => {
    timer = setTimeout(() => resolve([]), TEAM_NOTICES_TIMEOUT_MS);
  });
  const resolution = teamResolutionNotices(deps, installationId, owner, config).catch((error) => {
    logError('setup team resolution failed', error, { installationId: String(installationId) });
    return [];
  });
  try {
    return await Promise.race([resolution, timeout]);
  } finally {
    clearTimeout(timer);
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
  const operational = operationalConfig(installation);
  const teamNoticesPromise = safeTeamNotices(
    deps,
    installation.id,
    installation.accountLogin,
    operational,
  );
  const octokit = await deps.github.installationOctokit(installation.id);
  const [configRepo, connection, linearConnection, teamFailures, personFailures, admin] =
    await Promise.all([
      findConfigRepo(octokit, installation.accountLogin),
      getConnection(deps.db, installation.id, 'slack', deps.encryptionKey),
      getConnectionInfo(deps.db, installation.id, 'linear'),
      listFailedTeamDeliveries(deps.db, installation.id, TEAM_FAILURE_LIMIT),
      listFailedPersonDeliveryGroups(deps.db, installation.id, PERSON_FAILURE_GROUP_LIMIT),
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
  const linear: SetupStatus['linear'] = linearConnection
    ? {
        connected: true,
        workspace: linearConnection.externalName ?? linearConnection.externalId,
        urlKey: linearConnection.externalKey ?? '',
        invalid: linearConnection.invalidatedAt !== null || !linearConnection.externalKey,
      }
    : { connected: false };
  const teamNotices = await teamNoticesPromise;
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
    linear,
    trackerNotices: trackerNotices(operational, linear),
    teamNotices,
    teamFailures,
    personFailures,
    apiKeys,
    webhooks,
    supportEmail: deps.env.supportEmail,
  };
}
