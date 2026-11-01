import {
  type ChatChannel,
  type Message,
  type MessageRef,
  type PullRequestSnapshot,
  parseConfig,
  type StandwiseConfig,
} from '@standwise/core';
import { setInstallationConfig, upsertInstallation, upsertMember } from '@standwise/db';
import type { CheckRunInput, PullRequestDetail } from '@standwise/github';
import type { LinearOrganization, LinearTokens } from '@standwise/linear';
import { createMemoryQueue } from '@standwise/queue';
import { db } from '../../../db/test/setup';
import { createTrackerFor, type Deps, type WorkerDeps } from '../../src';

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
  webCode?: (code: string) => Promise<string>;
  slackExchange?: Deps['slack']['exchangeCode'];
  configRepo?: 'missing' | 'error';
  pulls?: Record<string, PullRequestDetail | null>;
  files?: Record<string, string[]>;
  codeowners?: Record<string, string | null>;
  checks?: { createError?: unknown };
  snapshots?: Record<string, PullRequestSnapshot[]>;
  teams?: Record<string, string[]>;
  truncatedTeams?: string[];
};

export function fakeLinear() {
  const state = {
    organization: { id: 'org-1', name: 'Acme Linear', urlKey: 'acme' } as LinearOrganization,
    tokens: {
      accessToken: 'lin_at_1',
      refreshToken: 'lin_rt_1',
      expiresAt: '2026-10-29T15:00:00.000Z',
    } as LinearTokens,
    refreshed: {
      accessToken: 'lin_at_2',
      refreshToken: 'lin_rt_2',
      expiresAt: '2026-10-29T16:00:00.000Z',
    } as LinearTokens,
    exchangeError: null as Error | null,
    refreshError: null as Error | null,
    graphqlStatus: 200,
    users: new Map<string, string>(),
    issues: new Map<string, unknown>(),
    activity: [] as unknown[],
    stale: [] as unknown[],
  };
  const calls = {
    exchanges: [] as { code: string; redirectUri: string; clientId: string }[],
    refreshes: [] as { refreshToken: string; clientId: string; clientSecret: string }[],
    bearer: [] as string[],
    userLookups: [] as string[],
    queries: [] as { name: string; variables: Record<string, unknown> }[],
  };
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls.bearer.push(new Headers(init?.headers).get('authorization') ?? '');
    if (state.graphqlStatus !== 200) return new Response('', { status: state.graphqlStatus });
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      query?: string;
      variables?: { email?: string; identifier?: string };
    };
    const name = /query (\w+)/.exec(body.query ?? '')?.[1] ?? '';
    calls.queries.push({ name, variables: { ...body.variables } });
    if (name === 'Issue') {
      const issue = state.issues.get(body.variables?.identifier ?? '');
      if (issue) return Response.json({ data: { issue } });
      return Response.json({
        errors: [{ message: 'Entity not found: Issue', extensions: { code: 'INVALID_INPUT' } }],
      });
    }
    if (name === 'CardActivity') {
      return Response.json({ data: { issues: { nodes: state.activity } } });
    }
    if (name === 'StaleInProgress') {
      return Response.json({ data: { issues: { nodes: state.stale } } });
    }
    if (body.query?.includes('UserByEmail')) {
      const email = (body.variables?.email ?? '').toLowerCase();
      calls.userLookups.push(email);
      const id = state.users.get(email);
      return Response.json({
        data: { users: { nodes: id ? [{ id, email }] : [] } },
      });
    }
    return Response.json({ data: { organization: state.organization } });
  }) as typeof fetch;
  const deps: Deps['linear'] = {
    exchangeCode: async (input) => {
      calls.exchanges.push({
        code: input.code,
        redirectUri: input.redirectUri,
        clientId: input.clientId,
      });
      if (state.exchangeError) throw state.exchangeError;
      return state.tokens;
    },
    refreshToken: async (input) => {
      calls.refreshes.push({
        refreshToken: input.refreshToken,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      });
      if (state.refreshError) throw state.refreshError;
      return state.refreshed;
    },
    fetch: fetchImpl,
  };
  return { deps, state, calls };
}

export function fakeDeps(opts: FakeOptions = {}) {
  const queue = createMemoryQueue();
  const linear = fakeLinear();
  const calls = {
    activity: [] as Date[],
    activityLogins: [] as string[],
    membership: [] as string[],
    roles: [] as string[],
    config: [] as string[],
    users: [] as number[],
    configRefs: [] as (string | undefined)[],
    getPullRequest: [] as string[],
    listPullRequestFiles: [] as string[],
    snapshots: [] as string[],
    codeowners: [] as { repo: string; ref: string }[],
    createCheckRun: [] as CheckRunInput[],
  };
  const orgMembers = new Set(['alice']);
  const roles = new Map<string, { role: string; state: string }>();
  const users = new Map<number, string>([[1, 'Alice']]);
  let now = new Date('2026-10-28T15:00:00Z');
  let userLookupError: unknown = null;
  let rolesError: unknown = null;
  const request = async (route: string, params: Record<string, unknown>) => {
    if (route === 'GET /orgs/{org}/members/{username}') {
      calls.membership.push(`${params.org}/${params.username}`);
      if (!orgMembers.has(String(params.username).toLowerCase())) {
        throw Object.assign(new Error('not found'), { status: 404 });
      }
      return { status: 204 };
    }
    if (route === 'GET /orgs/{org}/memberships/{username}') {
      calls.roles.push(`${params.org}/${params.username}`);
      if (rolesError) throw rolesError;
      const entry = roles.get(String(params.username).toLowerCase());
      if (!entry || params.org !== 'acme') {
        throw Object.assign(new Error('not found'), { status: 404 });
      }
      return { status: 200, data: entry };
    }
    if (route === 'GET /user/{account_id}') {
      calls.users.push(Number(params.account_id));
      if (userLookupError) throw userLookupError;
      const login = users.get(Number(params.account_id));
      if (!login) throw Object.assign(new Error('not found'), { status: 404 });
      return { status: 200, data: { id: Number(params.account_id), login } };
    }
    if (route === 'GET /repos/{owner}/{repo}') {
      if (opts.configRepo === 'missing') {
        throw Object.assign(new Error('not found'), { status: 404 });
      }
      if (opts.configRepo === 'error') {
        throw Object.assign(new Error('boom'), { status: 500 });
      }
      return { status: 200, data: { default_branch: 'trunk' } };
    }
    throw new Error(route);
  };
  const deps: Deps & Pick<WorkerDeps, 'email'> & { env: { betaEmailFrom: string } } = {
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
      listActivity: async (_o, _owner, login, since) => {
        calls.activity.push(since);
        calls.activityLogins.push(login);
        return [];
      },
      resolveTeamMembers: async (_o, _owner, members) => {
        const logins: string[] = [];
        const missingTeams: string[] = [];
        for (const m of members) {
          const known = opts.teams?.[m];
          if (known) logins.push(...known);
          else if (/^@[^/]+\/.+$/.test(m)) missingTeams.push(m);
          else logins.push(m.toLowerCase());
        }
        return {
          logins,
          missingTeams,
          truncatedTeams: members.filter((m) => opts.truncatedTeams?.includes(m)),
        };
      },
      fetchConfigSource: async (_o, owner, options) => {
        calls.config.push(owner);
        calls.configRefs.push(options?.ref);
        return opts.source ?? { found: false, reason: 'no_repo' };
      },
      getPullRequest: async (_o, ref) => {
        const key = `${ref.owner}/${ref.repo}#${ref.number}`;
        calls.getPullRequest.push(key);
        return opts.pulls?.[key] ?? null;
      },
      listPullRequestFiles: async (_o, ref) => {
        const key = `${ref.owner}/${ref.repo}#${ref.number}`;
        calls.listPullRequestFiles.push(key);
        return opts.files?.[key] ?? [];
      },
      listOpenPullRequestSnapshots: async (_o, _owner, _type, author) => {
        calls.snapshots.push(author);
        return opts.snapshots?.[author] ?? [];
      },
      fetchCodeowners: async (_o, owner, repo, ref) => {
        calls.codeowners.push({ repo: `${owner}/${repo}`, ref });
        return opts.codeowners?.[`${owner}/${repo}`] ?? null;
      },
      createCheckRun: async (_o, input) => {
        calls.createCheckRun.push(input);
        if (opts.checks?.createError) throw opts.checks.createError;
      },
      exchangeWebCode: opts.webCode ?? (async () => 'ghu_token'),
    },
    slack: {
      exchangeCode:
        opts.slackExchange ??
        (async () => ({ teamId: 'T1', teamName: 'Acme Workspace', botToken: 'xoxb-1' })),
    },
    linear: linear.deps,
    chatFor: async () =>
      ({
        findUserByEmail: async () => {
          if (opts.findUserError) throw opts.findUserError;
          return 'U9';
        },
      }) as never,
    trackerFor: (...args) => createTrackerFor(deps)(...args),
    email: null,
    env: {
      betaEmailFrom: 'Standwise <beta@sw.test>',
      publicUrl: 'https://sw.test',
      supportEmail: 'help@sw.test',
      docsUrl: 'https://docs.sw.test',
      landingUrl: 'https://landing.sw.test',
      appId: '1',
      webhookSecret: 'whsec',
      githubClientId: 'cid',
      githubClientSecret: 'secret',
      sessionSecret: 'sess',
      slackClientId: 'sid',
      slackClientSecret: 'ssecret',
      linearClientId: 'lid',
      linearClientSecret: 'lsecret',
    },
  };
  return {
    deps,
    queue,
    linear,
    calls,
    orgMembers,
    roles,
    users,
    setNow: (d: Date) => {
      now = d;
    },
    failRoles: (error: unknown) => {
      rolesError = error;
    },
    failUserLookup: (error: unknown) => {
      userLookupError = error;
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

export function fakeChat() {
  const posted: { channel: string; msg: Message }[] = [];
  const replies: { ref: MessageRef; msg: Message }[] = [];
  const directs: { userId: string; msg: Message }[] = [];
  let failure: Error | null = null;
  let counter = 0;
  const hooks: { afterSend?: () => Promise<void> } = {};
  const chat: ChatChannel = {
    postToChannel: async (channel, msg) => {
      if (failure) throw failure;
      posted.push({ channel, msg });
      counter++;
      await hooks.afterSend?.();
      return { channel: 'C1', id: `${counter}.0` };
    },
    replyInThread: async (ref, msg) => {
      if (failure) throw failure;
      replies.push({ ref, msg });
      counter++;
      await hooks.afterSend?.();
      return { channel: ref.channel, id: `${counter}.1` };
    },
    sendDirect: async (userId, msg) => {
      if (failure) throw failure;
      directs.push({ userId, msg });
      counter++;
      await hooks.afterSend?.();
      return { channel: `D${userId}`, id: `${counter}.2` };
    },
    findUserByEmail: async () => null,
  };
  return {
    chat,
    posted,
    replies,
    directs,
    hooks,
    failWith: (error: Error | null) => {
      failure = error;
    },
  };
}

export function flakyDb() {
  let armed = false;
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'update' && armed) {
        armed = false;
        return () => {
          throw new Error('db down');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return {
    db: proxy,
    failNextUpdate: () => {
      armed = true;
    },
  };
}
