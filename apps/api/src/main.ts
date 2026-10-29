import { createDb } from '@standwise/db';
import {
  createGitHubApp,
  fetchConfigSource,
  getUserProfile,
  listActivity,
  resolveTeamMembers,
} from '@standwise/github';
import { createChatFor, type Deps } from '@standwise/orchestrator';
import { createPgBossQueue } from '@standwise/queue';
import { createApp } from './app';
import { parseEnv } from './env';

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const queue = createPgBossQueue(env.DATABASE_URL);
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
  },
  chatFor: createChatFor(db, env.STANDWISE_ENCRYPTION_KEY),
  env: {
    publicUrl: env.PUBLIC_URL,
    supportEmail: env.SUPPORT_EMAIL,
    appId: env.GITHUB_APP_ID,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    slackClientId: env.SLACK_CLIENT_ID,
    slackClientSecret: env.SLACK_CLIENT_SECRET,
  },
};

await queue.start();

Bun.serve({ port: env.PORT, fetch: createApp(deps).fetch });
