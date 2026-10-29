import { parseConfig, type StandwiseConfig } from '@standwise/core';
import { setInstallationConfig, upsertInstallation, upsertMember } from '@standwise/db';
import { createMemoryQueue } from '@standwise/queue';
import { db } from '../../../db/test/setup';
import type { Deps } from '../../src';

export const INST = 11;

export function config(members = '[alice, bob]', extra = ''): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: ${members}
    chat: { provider: slack, channel: "#alpha" }
${extra}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

type Source = Awaited<ReturnType<Deps['github']['fetchConfigSource']>>;

export type FakeOptions = {
  profileError?: unknown;
  findUserError?: Error;
  source?: Source;
  installationIds?: number[];
};

export function fakeDeps(opts: FakeOptions = {}) {
  const queue = createMemoryQueue();
  const calls = { activity: [] as Date[], membership: [] as string[], config: [] as string[] };
  const orgMembers = new Set(['alice']);
  const users = new Map<number, string>([[1, 'Alice']]);
  let now = new Date('2026-10-28T15:00:00Z');
  const request = async (route: string, params: Record<string, unknown>) => {
    if (route === 'GET /orgs/{org}/members/{username}') {
      calls.membership.push(`${params.org}/${params.username}`);
      if (!orgMembers.has(String(params.username).toLowerCase())) {
        throw Object.assign(new Error('not found'), { status: 404 });
      }
      return { status: 204 };
    }
    if (route === 'GET /user/{account_id}') {
      const login = users.get(Number(params.account_id));
      if (!login) throw Object.assign(new Error('not found'), { status: 404 });
      return { status: 200, data: { id: Number(params.account_id), login } };
    }
    throw new Error(route);
  };
  const deps: Deps = {
    db,
    queue,
    now: () => now,
    encryptionKey: new Uint8Array(32).fill(7),
    github: {
      app: {} as Deps['github']['app'],
      installationOctokit: async () => ({ request }) as never,
      getUserProfile: async () => {
        if (opts.profileError) throw opts.profileError;
        return {
          githubUserId: 1,
          login: 'Alice',
          email: 'alice@acme.com',
          installationIds: opts.installationIds ?? [INST, 999],
        };
      },
      listActivity: async (_o, _owner, _login, since) => {
        calls.activity.push(since);
        return [];
      },
      resolveTeamMembers: async (_o, _owner, members) => members.map((m) => m.toLowerCase()),
      fetchConfigSource: async (_o, owner) => {
        calls.config.push(owner);
        return opts.source ?? { found: false, reason: 'no_repo' };
      },
    },
    chatFor: async () =>
      ({
        findUserByEmail: async () => {
          if (opts.findUserError) throw opts.findUserError;
          return 'U9';
        },
      }) as never,
    env: {
      publicUrl: 'https://sw.test',
      supportEmail: 'help@sw.test',
      appId: '1',
      webhookSecret: 'whsec',
      githubClientId: 'cid',
      githubClientSecret: 'secret',
      sessionSecret: 'sess',
      slackClientId: 'sid',
      slackClientSecret: 'ssecret',
    },
  };
  return {
    deps,
    queue,
    calls,
    orgMembers,
    users,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

export async function seedOrg(
  cfg: StandwiseConfig | null = config(),
  install: { id?: number; accountLogin?: string; accountType?: 'Organization' | 'User' } = {},
): Promise<void> {
  const id = install.id ?? INST;
  await upsertInstallation(db, {
    id,
    accountLogin: install.accountLogin ?? 'acme',
    accountType: install.accountType ?? 'Organization',
  });
  await setInstallationConfig(
    db,
    id,
    cfg ? { status: 'configured', config: cfg } : { status: 'unconfigured', reason: 'no_repo' },
  );
}

export async function seedMember(login = 'Alice', githubUserId = 1) {
  return upsertMember(db, { githubUserId, login, email: 'alice@acme.com' });
}

export const daily = {
  org: 'acme',
  yesterday: [{ text: 'did a thing' }],
  today: [{ text: 'do another' }],
  blockers: [],
};
