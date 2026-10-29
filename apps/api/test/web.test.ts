import { describe, expect, test } from 'bun:test';
import { parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  claimDelivery,
  createSession,
  failDelivery,
  getConnection,
  resolveSession,
  setInstallationConfig,
  setMemberInstallations,
  upsertInstallation,
  upsertMember,
} from '@standwise/db';
import type { Deps } from '@standwise/orchestrator';
import { createMemoryQueue } from '@standwise/queue';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { createApp } from '../src/app';

const KEY = new Uint8Array(32).fill(7);
const INST = 11;
const FOREIGN = 12;

function config(): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#alpha" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

function harness(opts: { hasConfigRepo?: boolean } = {}) {
  const slackCalls: { code: string; redirectUri: string }[] = [];
  const webCodes: string[] = [];
  const orgMembers = new Set(['alice']);
  const deps: Deps = {
    db,
    queue: createMemoryQueue(),
    now: () => new Date('2026-10-28T15:00:00Z'),
    encryptionKey: KEY,
    github: {
      app: {} as Deps['github']['app'],
      installationOctokit: async () =>
        ({
          request: async (route: string, params: Record<string, unknown>) => {
            if (route === 'GET /user/{account_id}') {
              return { status: 200, data: { id: 1, login: 'alice' } };
            }
            if (route === 'GET /orgs/{org}/members/{username}') {
              if (!orgMembers.has(String(params.username).toLowerCase())) {
                throw Object.assign(new Error('not found'), { status: 404 });
              }
              return { status: 204 };
            }
            if (route === 'GET /repos/{owner}/{repo}') {
              if (opts.hasConfigRepo === false) {
                throw Object.assign(new Error('not found'), { status: 404 });
              }
              return { status: 200, data: { default_branch: 'trunk' } };
            }
            throw new Error(route);
          },
        }) as never,
      getUserProfile: async () => ({
        githubUserId: 1,
        login: 'alice',
        email: 'alice@acme.com',
        installationIds: [INST],
      }),
      listActivity: async () => [],
      resolveTeamMembers: async (_o, _owner, members) => members,
      fetchConfigSource: async () => ({ found: false, reason: 'no_repo' }),
      exchangeWebCode: async (code) => {
        webCodes.push(code);
        return 'ghu_token';
      },
    },
    slack: {
      exchangeCode: async (p) => {
        slackCalls.push({ code: p.code, redirectUri: p.redirectUri });
        return { teamId: 'T123', botToken: 'xoxb-secret' };
      },
    },
    chatFor: async () => null,
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
  return { app: createApp(deps), slackCalls, webCodes, orgMembers };
}

async function seed(setup: (installationId: number) => Promise<void> = async () => {}) {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  await upsertInstallation(db, {
    id: FOREIGN,
    accountLogin: 'other',
    accountType: 'Organization',
  });
  const member = await upsertMember(db, { githubUserId: 1, login: 'alice', email: 'a@acme.com' });
  await setMemberInstallations(db, member.id, [INST]);
  await setInstallationConfig(db, INST, { status: 'configured', config: config() });
  await setup(INST);
  const token = await createSession(db, member.id, 'web');
  return { member, cookie: `sw_web=${token}`, token };
}

const location = (res: Response) => res.headers.get('location') ?? '';

describe('web login', () => {
  useCleanDb();

  test('setup requires login', async () => {
    const { app } = harness();
    const res = await app.request(`/setup?installation_id=${INST}`);
    expect(res.status).toBe(302);
    expect(location(res)).toBe(
      `/auth/github/login?next=${encodeURIComponent(`/setup?installation_id=${INST}`)}`,
    );
  });

  test('login redirects to github with a signed state', async () => {
    const { app } = harness();
    const res = await app.request('/auth/github/login?next=/setup%3Finstallation_id%3D11');
    expect(res.status).toBe(302);
    const url = new URL(location(res));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sw.test/auth/github/callback');
    expect(url.searchParams.get('state')).toContain('.');
  });

  test('callback creates a web session cookie and redirects to next', async () => {
    const { app, webCodes } = harness();
    await seed();
    const login = await app.request('/auth/github/login?next=/setup%3Finstallation_id%3D11');
    const state = new URL(location(login)).searchParams.get('state') ?? '';
    const res = await app.request(
      `/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/setup?installation_id=11');
    expect(webCodes).toEqual(['abc']);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('sw_web=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    const token = /sw_web=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect((await resolveSession(db, token, 'web'))?.login).toBe('alice');
  });

  test('callback rejects a tampered state', async () => {
    const { app, webCodes } = harness();
    const login = await app.request('/auth/github/login');
    const state = new URL(location(login)).searchParams.get('state') ?? '';
    const res = await app.request(`/auth/github/callback?code=abc&state=${state}x`);
    expect(res.status).toBe(400);
    expect(webCodes).toEqual([]);
  });

  for (const next of [
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'evil.com',
    '/\t/evil.com',
  ]) {
    test(`open redirect blocked: ${next}`, async () => {
      const { app } = harness();
      await seed();
      const login = await app.request(`/auth/github/login?next=${encodeURIComponent(next)}`);
      const state = new URL(location(login)).searchParams.get('state') ?? '';
      const res = await app.request(
        `/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(302);
      expect(location(res)).toBe('/');
    });
  }
});

describe('setup page', () => {
  useCleanDb();

  test('setup forbids foreign installation', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request(`/setup?installation_id=${FOREIGN}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  test('setup forbids a member who left the organization', async () => {
    const { app, orgMembers } = harness();
    const { cookie } = await seed();
    orgMembers.delete('alice');
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  test('setup shows errors for invalid config', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      await setInstallationConfig(db, id, {
        status: 'invalid',
        errors: [{ path: 'teams.0.digest_at', message: 'must be HH:MM (24h)' }],
      });
    });
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('teams.0.digest_at');
    expect(html).toContain('must be HH:MM (24h)');
  });

  test('setup shows the unconfigured reason', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      await setInstallationConfig(db, id, { status: 'unconfigured', reason: 'no_file' });
    });
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(await res.text()).toContain('no_file');
  });

  test('setup prefilled link', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = (await res.text()).replaceAll('&amp;', '&');
    expect(html).toContain(
      'https://github.com/acme/.github/new/trunk?filename=standwise.yml&value=',
    );
    expect(html).toContain('help@sw.test');
  });

  test('setup links to repo creation when .github is missing', async () => {
    const { app } = harness({ hasConfigRepo: false });
    const { cookie } = await seed();
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain('https://github.com/new?name=.github');
    expect(html).not.toContain('filename=standwise.yml');
  });

  test('setup lists failed deliveries', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      const key = {
        installationId: id,
        teamName: 'Alpha',
        date: '2026-10-28',
        kind: 'digest' as const,
      };
      const claim = await claimDelivery(db, key);
      if (claim.status !== 'claimed') throw new Error('not claimed');
      await failDelivery(db, key, claim.token, 'not_in_channel');
    });
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain('not_in_channel');
    expect(html).toContain('Alpha');
  });

  test('setup renders in english by Accept-Language and pt-BR by default', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const en = await app.request(`/setup?installation_id=${INST}`, {
      headers: { cookie, 'accept-language': 'en-US,en;q=0.9' },
    });
    expect(await en.text()).toContain('Connect Slack');
    const pt = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(await pt.text()).toContain('Conectar Slack');
  });

  test('setup shows the connected slack workspace', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const state = await app.request(`/connect/slack?installation_id=${INST}`, {
      headers: { cookie },
    });
    const value = new URL(location(state)).searchParams.get('state') ?? '';
    await app.request(`/oauth/slack/callback?code=c&state=${encodeURIComponent(value)}`, {
      headers: { cookie },
    });
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(await res.text()).toContain('T123');
  });
});

describe('slack connection', () => {
  useCleanDb();

  async function startConnect(app: ReturnType<typeof createApp>, cookie: string) {
    const res = await app.request(`/connect/slack?installation_id=${INST}`, {
      headers: { cookie },
    });
    return { res, state: new URL(location(res)).searchParams.get('state') ?? '' };
  }

  test('connect redirects to slack with a signed state', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const { res, state } = await startConnect(app, cookie);
    expect(res.status).toBe(302);
    const url = new URL(location(res));
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sw.test/oauth/slack/callback');
    expect(state).toContain('.');
  });

  test('connect forbids a foreign installation and requires login', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const forbidden = await app.request(`/connect/slack?installation_id=${FOREIGN}`, {
      headers: { cookie },
    });
    expect(forbidden.status).toBe(403);
    const anonymous = await app.request(`/connect/slack?installation_id=${INST}`);
    expect(anonymous.status).toBe(302);
    expect(location(anonymous)).toStartWith('/auth/github/login?next=');
  });

  test('slack callback rejects tampered state', async () => {
    const { app, slackCalls } = harness();
    const { cookie } = await seed();
    const { state } = await startConnect(app, cookie);
    const res = await app.request(`/oauth/slack/callback?code=c&state=${state}x`, {
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    expect(slackCalls).toEqual([]);
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
  });

  test('slack callback rejects a state started by another session', async () => {
    const { app, slackCalls } = harness();
    const { cookie, member } = await seed();
    const { state } = await startConnect(app, cookie);
    const other = `sw_web=${await createSession(db, member.id, 'web')}`;
    const res = await app.request(
      `/oauth/slack/callback?code=c&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie: other },
      },
    );
    expect(res.status).toBe(400);
    expect(slackCalls).toEqual([]);
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
  });

  test('slack callback rejects a github login state', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const login = await app.request('/auth/github/login');
    const state = new URL(location(login)).searchParams.get('state') ?? '';
    const res = await app.request(
      `/oauth/slack/callback?code=c&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie },
      },
    );
    expect(res.status).toBe(400);
  });

  test('slack callback without a session is unauthorized', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const { state } = await startConnect(app, cookie);
    const res = await app.request(
      `/oauth/slack/callback?code=c&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(401);
  });

  test('slack callback saves encrypted connection', async () => {
    const { app, slackCalls } = harness();
    const { cookie } = await seed();
    const { state } = await startConnect(app, cookie);
    const res = await app.request(
      `/oauth/slack/callback?code=c1&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie },
      },
    );
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`/setup?installation_id=${INST}`);
    expect(slackCalls).toEqual([
      { code: 'c1', redirectUri: 'https://sw.test/oauth/slack/callback' },
    ]);
    expect(await getConnection(db, INST, 'slack', KEY)).toEqual({
      externalId: 'T123',
      secret: 'xoxb-secret',
    });
  });
});
