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
import {
  createChatFor,
  createTrackerFor,
  DELIVER_WEBHOOK_JOB,
  LINK_TRACKER_IDENTITIES_JOB,
  LINK_TRACKER_IDENTITY_JOB,
  LOAD_CONFIG_JOB,
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
import { linkTrackerIdentitiesJob } from './jobs/link-tracker-identities';
import { linkTrackerIdentityJob } from './jobs/link-tracker-identity';
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
  trackerFor: (...args) => createTrackerFor(deps)(...args),
  linear: { exchangeCode: exchangeLinearCode, refreshToken: refreshLinearToken },
  env: {
    linearClientId: env.LINEAR_CLIENT_ID,
    linearClientSecret: env.LINEAR_CLIENT_SECRET,
  },
};

await queue.start();
const plain = { policies: ['plain'] } as const;
const keyed = { policies: ['keyed'] } as const;
const stately = { policies: ['stately'] } as const;

await queue.work('tick', tickJob(deps), plain);
await queue.work('send-digest', sendDigestJob(deps), keyed);
await queue.work('send-late-daily', sendLateDailyJob(deps), plain);
await queue.work('send-reminder', sendReminderJob(deps), keyed);
await queue.work(ROUTE_BLOCKER_JOB, routeBlockerJob(deps), keyed);
await queue.work(SCAN_MEMBER_SIGNALS_JOB, scanMemberSignalsJob(deps), stately);
await queue.work(RESOLVE_CHECK_SUITE_JOB, resolveCheckSuiteJob(deps), plain);
await queue.work(VALIDATE_CONFIG_JOB, validateConfigJob(deps), keyed);
await queue.work(LOAD_CONFIG_JOB, loadConfigJob(deps), stately);
await queue.work(LINK_TRACKER_IDENTITIES_JOB, linkTrackerIdentitiesJob(deps), stately);
await queue.work(LINK_TRACKER_IDENTITY_JOB, linkTrackerIdentityJob(deps), stately);
await queue.work(DELIVER_WEBHOOK_JOB, deliverWebhookJob(deps), plain);
await queue.work('requeue-webhooks', requeueWebhooksJob(deps), plain);
await queue.work(PRUNE_DATA_JOB, pruneDataJob(deps), plain);
await queue.schedule('tick', '* * * * *');
await queue.schedule('requeue-webhooks', '*/5 * * * *');
await queue.schedule(PRUNE_DATA_JOB, '17 3 * * *');

async function shutdown(): Promise<void> {
  await queue.stop();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
