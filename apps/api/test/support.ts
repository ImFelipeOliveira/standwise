import type { Deps } from '@standwise/orchestrator';
import { createMemoryQueue } from '@standwise/queue';
import { db } from '../../../packages/db/test/setup';
import { createApp } from '../src/app';

export function createTestApp(options: { trustProxy?: boolean } = {}) {
  let now = new Date('2026-10-28T15:00:05Z');
  const deps: Deps = {
    db,
    queue: createMemoryQueue(),
    now: () => now,
    encryptionKey: new Uint8Array(32).fill(7),
    github: {
      app: {} as Deps['github']['app'],
      installationOctokit: async () => ({}) as never,
      getUserProfile: async () => ({
        githubUserId: 1,
        login: 'Alice',
        email: 'alice@acme.com',
        installationIds: [],
      }),
      listActivity: async () => [],
      resolveTeamMembers: async (_o, _owner, members) => members,
      fetchConfigSource: async () => ({ found: false, reason: 'no_repo' }),
      exchangeWebCode: async () => {
        throw new Error('unused');
      },
    },
    slack: {
      exchangeCode: async () => {
        throw new Error('unused');
      },
    },
    chatFor: async () => null,
    env: {
      publicUrl: 'https://sw.test',
      supportEmail: 'help@sw.test',
      githubClientId: 'cid',
      githubClientSecret: 'secret',
      sessionSecret: 'sess',
      slackClientId: 'sid',
      slackClientSecret: 'ssecret',
      appId: '1',
      webhookSecret: 'whsec',
    },
  };
  return { app: createApp(deps, options), setNow: (d: Date) => (now = d) };
}
