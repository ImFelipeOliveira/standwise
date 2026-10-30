import type { ChatChannel } from '@standwise/core';
import type { Db } from '@standwise/db';
import type {
  App,
  fetchConfigSource,
  getUserProfile,
  listActivity,
  Octokit,
  resolveTeamMembers,
} from '@standwise/github';
import type { JobQueue } from '@standwise/queue';
import type { exchangeSlackCode } from '@standwise/slack';
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
    exchangeWebCode: (code: string) => Promise<string>;
  };
  slack: {
    exchangeCode: typeof exchangeSlackCode;
  };
  chatFor: (installationId: number, provider: 'slack') => Promise<ChatChannel | null>;
  webhookTransport?: SafeFetchOptions;
  env: {
    publicUrl: string;
    supportEmail: string;
    appId: string;
    webhookSecret: string;
    githubClientId: string;
    githubClientSecret: string;
    sessionSecret: string;
    slackClientId: string;
    slackClientSecret: string;
  };
};

export type WorkerDeps = Pick<
  Deps,
  'db' | 'queue' | 'now' | 'chatFor' | 'github' | 'encryptionKey' | 'webhookTransport'
>;
