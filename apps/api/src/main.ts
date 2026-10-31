import { createDb } from '@standwise/db';
import {
  createCheckRun,
  createGitHubApp,
  exchangeWebCode,
  fetchCodeowners,
  fetchConfigSource,
  getPullRequest,
  getUserProfile,
  listActivity,
  listOpenPullRequestSnapshots,
  listPullRequestFiles,
  resolveTeamMembers,
} from '@standwise/github';
import { exchangeLinearCode, refreshLinearToken } from '@standwise/linear';
import { createChatFor, createTrackerFor, type Deps } from '@standwise/orchestrator';
import { createPgBossQueue } from '@standwise/queue';
import { exchangeSlackCode } from '@standwise/slack';
import { createApp } from './app';
import { parseEnv } from './env';
import { clientIpResolver } from './middleware/rate-limit';
import { gracefulShutdown } from './shutdown';

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const queue = createPgBossQueue(env.DATABASE_URL, {
  retryDelaySeconds: 120,
  retryBackoff: true,
});
const app = createGitHubApp({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
});

const deps: Deps = {
  db,
  queue,
  now: () => new Date(),
  encryptionKey: env.STANDWISE_ENCRYPTION_KEY,
  github: {
    app,
    installationOctokit: (installationId) => app.getInstallationOctokit(installationId),
    getUserProfile,
    listActivity,
    resolveTeamMembers,
    fetchConfigSource,
    getPullRequest,
    listPullRequestFiles,
    listOpenPullRequestSnapshots,
    fetchCodeowners,
    createCheckRun,
    exchangeWebCode: (code) =>
      exchangeWebCode({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
  },
  slack: { exchangeCode: exchangeSlackCode },
  linear: { exchangeCode: exchangeLinearCode, refreshToken: refreshLinearToken },
  chatFor: createChatFor(db, env.STANDWISE_ENCRYPTION_KEY),
  trackerFor: (...args) => createTrackerFor(deps)(...args),
  env: {
    publicUrl: env.PUBLIC_URL,
    supportEmail: env.SUPPORT_EMAIL,
    docsUrl: env.DOCS_URL,
    appId: env.GITHUB_APP_ID,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    slackClientId: env.SLACK_CLIENT_ID,
    slackClientSecret: env.SLACK_CLIENT_SECRET,
    linearClientId: env.LINEAR_CLIENT_ID,
    linearClientSecret: env.LINEAR_CLIENT_SECRET,
  },
};

await queue.start();

const api = createApp(deps, {
  getClientIp: clientIpResolver({ trustProxy: env.TRUST_PROXY, hops: env.TRUSTED_PROXY_HOPS }),
});

const server = Bun.serve({
  port: env.PORT,
  fetch: (request, server) => api.fetch(request, { server }),
});

const shutdown = gracefulShutdown({
  server: { stop: () => server.stop() },
  queue,
  exit: (code) => process.exit(code),
});

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
