import {
  deleteInstallation,
  getInstallation,
  operationalConfig,
  upsertInstallation,
} from '@standwise/db';
import type { Deps } from '../deps';
import { resolveTeams } from '../teams';
import { loadInstallationConfig } from './load-installation-config';
import { SCAN_MEMBER_SIGNALS_JOB, type ScanMemberSignalsJob } from './scan-member-signals';

const CONFIG_REPO = '.github';
const CONFIG_FILE = 'standwise.yml';

type Account = { id?: number; login?: string; type?: string };

export type GitHubEventPayload = {
  action?: string;
  ref?: string;
  installation?: { id?: number; account?: Account };
  repository?: { name?: string; default_branch?: string; owner?: { login?: string } };
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
  pull_request?: { number?: number; user?: { login?: string } };
  check_suite?: { pull_requests?: { number?: number }[] };
};

export const MAX_CHECK_SUITE_LOOKUPS = 5;

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
  await loadInstallationConfig(deps, installationId, account.login);
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

async function onPush(deps: Deps, payload: GitHubEventPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const repository = payload.repository;
  if (installationId === undefined || !repository) return;
  if (repository.name !== CONFIG_REPO) return;
  if (payload.ref !== `refs/heads/${repository.default_branch}`) return;
  if (!touchesConfig(payload)) return;
  const installation = await getInstallation(deps.db, installationId);
  if (!installation) return;
  await loadInstallationConfig(deps, installationId, installation.accountLogin);
}

function logSignalFailure(error: unknown): void {
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  console.error('signal scan enqueue failed', {
    name: String(e.name),
    code: String(e.code),
    message: String(e.message),
  });
}

async function checkSuiteAuthors(
  deps: Deps,
  installationId: number,
  owner: string,
  repo: string,
  payload: GitHubEventPayload,
): Promise<string[]> {
  const numbers = (payload.check_suite?.pull_requests ?? [])
    .map((pr) => pr.number)
    .filter((n): n is number => typeof n === 'number')
    .slice(0, MAX_CHECK_SUITE_LOOKUPS);
  if (numbers.length === 0) return [];
  const octokit = await deps.github.installationOctokit(installationId);
  const authors: string[] = [];
  for (const number of numbers) {
    try {
      const detail = await deps.github.getPullRequest(octokit, { owner, repo, number });
      if (detail) authors.push(detail.author);
    } catch (error) {
      logSignalFailure(error);
    }
  }
  return authors;
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

  const teams = await resolveTeams(deps, installationId, installation.accountLogin, config);
  const members = new Set(teams.flatMap((team) => team.memberLogins));
  const authors =
    name === 'check_suite'
      ? await checkSuiteAuthors(deps, installationId, owner, repo, payload)
      : [payload.pull_request?.user?.login ?? ''];
  const logins = [...new Set(authors.map((a) => a.toLowerCase()))];
  for (const login of logins) {
    if (!members.has(login)) continue;
    const job: ScanMemberSignalsJob = { installationId, login };
    await deps.queue.enqueue(SCAN_MEMBER_SIGNALS_JOB, job, {
      singletonKey: `scan:${installationId}:${login}`,
    });
  }
}

async function onSignalEvent(deps: Deps, name: string, payload: GitHubEventPayload): Promise<void> {
  try {
    await enqueueSignalScans(deps, name, payload);
  } catch (error) {
    logSignalFailure(error);
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
  else if (name && Object.hasOwn(SIGNAL_ACTIONS, name)) await onSignalEvent(deps, name, payload);
}
