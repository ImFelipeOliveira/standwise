import {
  deleteInstallation,
  getInstallation,
  operationalConfig,
  upsertInstallation,
} from '@standwise/db';
import type { Deps } from '../deps';
import { logError } from '../log-error';
import { enqueueLoadConfig } from './load-installation-config';
import {
  MAX_CHECK_SUITE_LOOKUPS,
  RESOLVE_CHECK_SUITE_JOB,
  type ResolveCheckSuiteJob,
} from './resolve-check-suite';
import { enqueueMemberScan } from './scan-member-signals';
import { CONFIG_FILE, CONFIG_REPO, enqueueValidateConfig } from './validate-config-at-ref';

type Account = { id?: number; login?: string; type?: string };

export type GitHubEventPayload = {
  action?: string;
  ref?: string;
  after?: string;
  deleted?: boolean;
  forced?: boolean;
  installation?: { id?: number; account?: Account };
  repository?: { name?: string; default_branch?: string; owner?: { login?: string } };
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
  pull_request?: { number?: number; head?: { sha?: string }; user?: { login?: string } };
  check_suite?: { pull_requests?: { number?: number }[] };
};

const CONFIG_PR_ACTIONS = ['opened', 'synchronize', 'reopened'];

const SIGNAL_ACTIONS: Record<string, string[]> = {
  pull_request: ['opened', 'ready_for_review', 'synchronize', 'closed', 'reopened'],
  pull_request_review: ['submitted', 'dismissed'],
  check_suite: ['completed'],
};

function touchesConfig(payload: GitHubEventPayload): boolean {
  return (payload.commits ?? []).some((commit) =>
    [...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])].includes(
      CONFIG_FILE,
    ),
  );
}

async function syncInstallation(
  deps: Deps,
  installationId: number,
  account: Account & { login: string },
): Promise<void> {
  await upsertInstallation(deps.db, {
    id: installationId,
    accountLogin: account.login,
    accountType: account.type === 'Organization' ? 'Organization' : 'User',
    accountId: account.id ?? null,
  });
  await enqueueLoadConfig(deps, { installationId, owner: account.login });
}

async function onInstallation(deps: Deps, payload: GitHubEventPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const account = payload.installation?.account;
  if (installationId === undefined) return;
  if (payload.action === 'deleted') {
    await deleteInstallation(deps.db, installationId);
    return;
  }
  if (payload.action !== 'created' || !account?.login) return;
  await syncInstallation(deps, installationId, { ...account, login: account.login });
}

async function onInstallationRepositories(deps: Deps, payload: GitHubEventPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const account = payload.installation?.account;
  if (installationId === undefined || !account?.login) return;
  await syncInstallation(deps, installationId, { ...account, login: account.login });
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function onPush(deps: Deps, payload: GitHubEventPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const repository = payload.repository;
  if (installationId === undefined || !repository || !payload.after) return;
  if (repository.name !== CONFIG_REPO || payload.deleted || !repository.owner?.login) return;
  const onDefaultBranch = payload.ref === `refs/heads/${repository.default_branch}`;
  const validate =
    payload.forced === true || (payload.commits ?? []).length === 0 || touchesConfig(payload);
  if (!validate && !onDefaultBranch) return;
  const installation = await getInstallation(deps.db, installationId);
  if (!installation || !sameLogin(repository.owner.login, installation.accountLogin)) return;
  const owner = installation.accountLogin;
  if (validate)
    await enqueueValidateConfig(deps, { installationId, owner, headSha: payload.after });
  if (onDefaultBranch) await enqueueLoadConfig(deps, { installationId, owner });
}

async function onConfigPullRequest(deps: Deps, payload: GitHubEventPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const repository = payload.repository;
  const pullNumber = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;
  if (installationId === undefined || repository?.name !== CONFIG_REPO) return;
  if (!CONFIG_PR_ACTIONS.includes(payload.action ?? '')) return;
  if (typeof pullNumber !== 'number' || !headSha || !repository.owner?.login) return;
  const installation = await getInstallation(deps.db, installationId);
  if (!installation || !sameLogin(repository.owner.login, installation.accountLogin)) return;
  await enqueueValidateConfig(deps, {
    installationId,
    owner: installation.accountLogin,
    headSha,
    pullNumber,
  });
}

async function enqueueSignalScans(
  deps: Deps,
  name: string,
  payload: GitHubEventPayload,
): Promise<void> {
  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  if (installationId === undefined || !owner || !repo) return;
  if (!SIGNAL_ACTIONS[name]?.includes(payload.action ?? '')) return;
  const installation = await getInstallation(deps.db, installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;
  if (owner.toLowerCase() !== installation.accountLogin.toLowerCase()) return;

  if (name === 'check_suite') {
    const numbers = (payload.check_suite?.pull_requests ?? [])
      .map((pr) => pr.number)
      .filter((n): n is number => typeof n === 'number')
      .slice(0, MAX_CHECK_SUITE_LOOKUPS);
    if (numbers.length === 0) return;
    const job: ResolveCheckSuiteJob = { installationId, owner, repo, numbers };
    await deps.queue.enqueue(RESOLVE_CHECK_SUITE_JOB, job);
    return;
  }

  const author = payload.pull_request?.user?.login?.toLowerCase();
  if (!author) return;
  await enqueueMemberScan(deps, installationId, author);
}

async function onSignalEvent(deps: Deps, name: string, payload: GitHubEventPayload): Promise<void> {
  try {
    await enqueueSignalScans(deps, name, payload);
  } catch (error) {
    logError('signal scan enqueue failed', error);
  }
}

export async function handleGitHubEvent(
  deps: Deps,
  name: string | undefined,
  payload: GitHubEventPayload,
): Promise<void> {
  if (name === 'installation') await onInstallation(deps, payload);
  else if (name === 'installation_repositories') await onInstallationRepositories(deps, payload);
  else if (name === 'push') await onPush(deps, payload);
  else if (name === 'pull_request') {
    await onConfigPullRequest(deps, payload);
    await onSignalEvent(deps, name, payload);
  } else if (name && Object.hasOwn(SIGNAL_ACTIONS, name)) await onSignalEvent(deps, name, payload);
}
