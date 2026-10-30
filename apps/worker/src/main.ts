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
import { createChatFor, DELIVER_WEBHOOK_JOB, type WorkerDeps } from '@standwise/orchestrator';
import { createPgBossQueue } from '@standwise/queue';
import { parseEnv } from './env';
import { deliverWebhookJob, requeueWebhooksJob } from './jobs/deliver-webhook';
import { sendDigestJob } from './jobs/send-digest';
import { sendLateDailyJob } from './jobs/send-late-daily';
import { tickJob } from './jobs/tick';

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
  chatFor: createChatFor(db, env.STANDWISE_ENCRYPTION_KEY),
};

await queue.start();
await queue.work('tick', tickJob(deps));
await queue.work('send-digest', sendDigestJob(deps));
await queue.work('send-late-daily', sendLateDailyJob(deps));
await queue.work(DELIVER_WEBHOOK_JOB, deliverWebhookJob(deps));
await queue.work('requeue-webhooks', requeueWebhooksJob(deps));
await queue.schedule('tick', '* * * * *');
await queue.schedule('requeue-webhooks', '*/5 * * * *');

async function shutdown(): Promise<void> {
  await queue.stop();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
