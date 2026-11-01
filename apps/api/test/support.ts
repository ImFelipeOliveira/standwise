import { type Deps, nullTracker } from '@standcast/orchestrator';
import { createMemoryQueue } from '@standcast/queue';
import type { Context } from 'hono';
import { db } from '../../../packages/db/test/setup';
import { createApp } from '../src/app';

export const TEST_IP = '192.0.2.1';

export const headerIp = (c: Context) => c.req.header('x-test-ip') ?? TEST_IP;

export type FakeRequest = (route: string, params: Record<string, unknown>) => Promise<unknown>;

export function createTestApp(
  options: {
    getClientIp?: (c: Context) => string;
    request?: FakeRequest;
    db?: Deps['db'];
    healthTimeoutMs?: number;
  } = {},
) {
  let now = new Date('2026-10-28T15:00:05Z');
  const queue = createMemoryQueue();
  const deps: Deps = {
    db: options.db ?? db,
    queue,
    now: () => now,
    encryptionKey: new Uint8Array(32).fill(7),
    github: {
      app: {} as Deps['github']['app'],
      installationOctokit: async () =>
        ({ request: options.request ?? (async () => ({})) }) as never,
      getUserProfile: async (githubToken: string) => {
        const id = Number(githubToken.slice(4)) || 1;
        return {
          githubUserId: id,
          login: `user${id}`,
          email: `user${id}@acme.com`,
          installationIds: [],
        };
      },
      listActivity: async () => [],
      resolveTeamMembers: async (_o, _owner, members) => ({
        logins: members,
        missingTeams: [],
        truncatedTeams: [],
      }),
      fetchConfigSource: async () => ({ found: false, reason: 'no_repo' }),
      getPullRequest: async () => null,
      listPullRequestFiles: async () => [],
      listOpenPullRequestSnapshots: async () => [],
      fetchCodeowners: async () => null,
      createCheckRun: async () => {},
      exchangeWebCode: async () => {
        throw new Error('unused');
      },
    },
    slack: {
      exchangeCode: async () => {
        throw new Error('unused');
      },
    },
    linear: {
      exchangeCode: async () => {
        throw new Error('unused');
      },
      refreshToken: async () => {
        throw new Error('unused');
      },
    },
    chatFor: async () => null,
    trackerFor: async () => nullTracker,
    env: {
      publicUrl: 'https://sw.test',
      supportEmail: 'help@sw.test',
      docsUrl: 'https://docs.sw.test',
      landingUrl: 'https://landing.sw.test',
      githubClientId: 'cid',
      githubClientSecret: 'secret',
      sessionSecret: 'sess',
      slackClientId: 'sid',
      slackClientSecret: 'ssecret',
      linearClientId: 'lid',
      linearClientSecret: 'lsecret',
      appId: '1',
      webhookSecret: 'whsec',
    },
  };
  return {
    app: createApp(deps, {
      getClientIp: options.getClientIp ?? headerIp,
      ...(options.healthTimeoutMs ? { healthTimeoutMs: options.healthTimeoutMs } : {}),
    }),
    queue,
    setNow: (d: Date) => (now = d),
  };
}
