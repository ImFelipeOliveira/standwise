import type { ChatChannel } from '@standwise/core';
import type { Db } from '@standwise/db';
import type {
  App,
  createCheckRun,
  fetchCodeowners,
  fetchConfigSource,
  getPullRequest,
  getUserProfile,
  listActivity,
  listOpenPullRequestSnapshots,
  listPullRequestFiles,
  Octokit,
  resolveTeamMembers,
} from '@standwise/github';
import type { exchangeLinearCode, LinearFetch, refreshLinearToken } from '@standwise/linear';
import type { JobQueue } from '@standwise/queue';
import type { EmailMessage } from '@standwise/resend';
import type { exchangeSlackCode } from '@standwise/slack';
import type { TrackerFor } from './linear-tracker';
import type { SafeFetchOptions } from './safe-fetch';

export type Deps = {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  encryptionKey: Uint8Array;
  github: {
    app: App;
    installationOctokit: (installationId: number) => Promise<Octokit>;
    getUserProfile: typeof getUserProfile;
    listActivity: typeof listActivity;
    resolveTeamMembers: typeof resolveTeamMembers;
    fetchConfigSource: typeof fetchConfigSource;
    getPullRequest: typeof getPullRequest;
    listPullRequestFiles: typeof listPullRequestFiles;
    listOpenPullRequestSnapshots: typeof listOpenPullRequestSnapshots;
    fetchCodeowners: typeof fetchCodeowners;
    createCheckRun: typeof createCheckRun;
    exchangeWebCode: (code: string) => Promise<string>;
  };
  slack: {
    exchangeCode: typeof exchangeSlackCode;
  };
  linear: {
    exchangeCode: typeof exchangeLinearCode;
    refreshToken: typeof refreshLinearToken;
    fetch?: LinearFetch;
  };
  chatFor: (installationId: number, provider: 'slack') => Promise<ChatChannel | null>;
  trackerFor: TrackerFor;
  webhookTransport?: SafeFetchOptions;
  env: {
    publicUrl: string;
    supportEmail: string;
    docsUrl: string;
    appId: string;
    webhookSecret: string;
    githubClientId: string;
    githubClientSecret: string;
    sessionSecret: string;
    slackClientId: string;
    slackClientSecret: string;
    linearClientId: string;
    linearClientSecret: string;
  };
};

export type EmailSender = { send(message: EmailMessage): Promise<void> };

export type WorkerDeps = Pick<
  Deps,
  | 'db'
  | 'queue'
  | 'now'
  | 'chatFor'
  | 'github'
  | 'encryptionKey'
  | 'webhookTransport'
  | 'trackerFor'
  | 'linear'
> & {
  email: EmailSender | null;
  env: Pick<Deps['env'], 'linearClientId' | 'linearClientSecret' | 'supportEmail'> & {
    betaEmailFrom: string;
  };
};
