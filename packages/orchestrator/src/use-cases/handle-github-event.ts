import { deleteInstallation, getInstallation, upsertInstallation } from '@standwise/db';
import type { Deps } from '../deps';
import { loadInstallationConfig } from './load-installation-config';

const CONFIG_REPO = '.github';
const CONFIG_FILE = 'standwise.yml';

type Account = { id?: number; login?: string; type?: string };

export type GitHubEventPayload = {
  action?: string;
  ref?: string;
  installation?: { id?: number; account?: Account };
  repository?: { name?: string; default_branch?: string; owner?: { login?: string } };
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
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

export async function handleGitHubEvent(
  deps: Deps,
  name: string | undefined,
  payload: GitHubEventPayload,
): Promise<void> {
  if (name === 'installation') await onInstallation(deps, payload);
  else if (name === 'installation_repositories') await onInstallationRepositories(deps, payload);
  else if (name === 'push') await onPush(deps, payload);
}
