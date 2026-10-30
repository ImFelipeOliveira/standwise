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
import {
  createChatFor,
  DELIVER_WEBHOOK_JOB,
  LOAD_CONFIG_JOB,
  nullTracker,
  PRUNE_DATA_JOB,
  RESOLVE_CHECK_SUITE_JOB,
  ROUTE_BLOCKER_JOB,
  SCAN_MEMBER_SIGNALS_JOB,
  VALIDATE_CONFIG_JOB,
  type WorkerDeps,
} from '@standwise/orchestrator';
import { createPgBossQueue } from '@standwise/queue';
import { parseEnv } from './env';
import { deliverWebhookJob, requeueWebhooksJob } from './jobs/deliver-webhook';
import { loadConfigJob } from './jobs/load-config';
import { pruneDataJob } from './jobs/prune-data';
import { resolveCheckSuiteJob } from './jobs/resolve-check-suite';
import { routeBlockerJob } from './jobs/route-blocker';
import { scanMemberSignalsJob } from './jobs/scan-member-signals';
import { sendDigestJob } from './jobs/send-digest';
import { sendLateDailyJob } from './jobs/send-late-daily';
import { sendReminderJob } from './jobs/send-reminder';
import { tickJob } from './jobs/tick';
import { validateConfigJob } from './jobs/validate-config';

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
  tracker: nullTracker,
};

await queue.start();
await queue.work('tick', tickJob(deps));
await queue.work('send-digest', sendDigestJob(deps));
await queue.work('send-late-daily', sendLateDailyJob(deps));
await queue.work('send-reminder', sendReminderJob(deps));
await queue.work(ROUTE_BLOCKER_JOB, routeBlockerJob(deps));
await queue.work(SCAN_MEMBER_SIGNALS_JOB, scanMemberSignalsJob(deps));
await queue.work(RESOLVE_CHECK_SUITE_JOB, resolveCheckSuiteJob(deps));
await queue.work(VALIDATE_CONFIG_JOB, validateConfigJob(deps));
await queue.work(LOAD_CONFIG_JOB, loadConfigJob(deps));
await queue.work(DELIVER_WEBHOOK_JOB, deliverWebhookJob(deps));
await queue.work('requeue-webhooks', requeueWebhooksJob(deps));
await queue.work(PRUNE_DATA_JOB, pruneDataJob(deps));
await queue.schedule('tick', '* * * * *');
await queue.schedule('requeue-webhooks', '*/5 * * * *');
await queue.schedule(PRUNE_DATA_JOB, '17 3 * * *');

async function shutdown(): Promise<void> {
  await queue.stop();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
