import { Webhooks } from '@octokit/webhooks';
import { deleteInstallation, getInstallation, upsertInstallation } from '@standwise/db';
import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { loadInstallationConfig } from '../services/config-loader';

const CONFIG_REPO = '.github';
const CONFIG_FILE = 'standwise.yml';

type Account = { login?: string; type?: string };

type Payload = {
  action?: string;
  ref?: string;
  installation?: { id?: number; account?: Account };
  repository?: { name?: string; default_branch?: string; owner?: { login?: string } };
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
};

function touchesConfig(payload: Payload): boolean {
  return (payload.commits ?? []).some((commit) =>
    [...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])].includes(
      CONFIG_FILE,
    ),
  );
}

async function onInstallation(deps: Deps, payload: Payload): Promise<void> {
  const installationId = payload.installation?.id;
  const account = payload.installation?.account;
  if (installationId === undefined) return;
  if (payload.action === 'deleted') {
    await deleteInstallation(deps.db, installationId);
    return;
  }
  if (payload.action !== 'created' || !account?.login) return;
  await upsertInstallation(deps.db, {
    id: installationId,
    accountLogin: account.login,
    accountType: account.type === 'Organization' ? 'Organization' : 'User',
  });
  await loadInstallationConfig(deps, installationId, account.login);
}

async function onInstallationRepositories(deps: Deps, payload: Payload): Promise<void> {
  const installationId = payload.installation?.id;
  const account = payload.installation?.account;
  if (installationId === undefined || !account?.login) return;
  await upsertInstallation(deps.db, {
    id: installationId,
    accountLogin: account.login,
    accountType: account.type === 'Organization' ? 'Organization' : 'User',
  });
  await loadInstallationConfig(deps, installationId, account.login);
}

async function onPush(deps: Deps, payload: Payload): Promise<void> {
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

export function webhookRoutes(deps: Deps): Hono {
  const webhooks = new Webhooks({ secret: deps.env.webhookSecret });
  const app = new Hono();
  app.post('/github', async (c) => {
    const body = await c.req.text();
    const signature = c.req.header('x-hub-signature-256');
    if (!signature || !(await webhooks.verify(body, signature).catch(() => false))) {
      return c.json({ error: { code: 'invalid_signature', message: 'invalid signature' } }, 401);
    }
    let payload: Payload;
    try {
      payload = JSON.parse(body) as Payload;
    } catch {
      return c.json({ error: { code: 'invalid_request', message: 'invalid json' } }, 400);
    }
    const event = c.req.header('x-github-event');
    if (event === 'installation') await onInstallation(deps, payload);
    else if (event === 'installation_repositories') await onInstallationRepositories(deps, payload);
    else if (event === 'push') await onPush(deps, payload);
    return c.json({ accepted: true }, 202);
  });
  return app;
}
