import { createDb } from '@standwise/db';
import {
  createGitHubApp,
  exchangeWebCode,
  fetchConfigSource,
  getUserProfile,
  listActivity,
  resolveTeamMembers,
} from '@standwise/github';
import { createChatFor, type WorkerDeps } from '@standwise/orchestrator';
import { createPgBossQueue } from '@standwise/queue';
import { parseEnv } from './env';
import { sendDigestJob } from './jobs/send-digest';
import { sendLateDailyJob } from './jobs/send-late-daily';
import { tickJob } from './jobs/tick';

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

const deps: WorkerDeps = {
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
    exchangeWebCode: (code) =>
      exchangeWebCode({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
  },
  chatFor: createChatFor(db, env.STANDWISE_ENCRYPTION_KEY),
};

await queue.start();
await queue.work('tick', tickJob(deps));
await queue.work('send-digest', sendDigestJob(deps));
await queue.work('send-late-daily', sendLateDailyJob(deps));
await queue.schedule('tick', '* * * * *');
