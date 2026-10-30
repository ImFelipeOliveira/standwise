import { describe, expect, test } from 'bun:test';
import { parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  claimDelivery,
  createSession,
  failDelivery,
  getConnection,
  listMemberInstallations,
  resolveSession,
  saveConnection,
  setInstallationAccessWarning,
  setInstallationConfig,
  setMemberInstallations,
  upsertInstallation,
  upsertMember,
} from '@standwise/db';
import { csrfToken, type Deps, nullTracker } from '@standwise/orchestrator';
import { createMemoryQueue } from '@standwise/queue';
import { ChatDeliveryError } from '@standwise/slack';
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

function harness(
  opts: { hasConfigRepo?: boolean; slackFails?: boolean; githubInstallations?: number[] } = {},
) {
  const slackCalls: { code: string; redirectUri: string }[] = [];
  const webCodes: string[] = [];
  const orgMembers = new Set(['alice']);
  const admins = new Set(['alice']);
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
              if (params.org !== 'acme' || !orgMembers.has(String(params.username).toLowerCase())) {
                throw Object.assign(new Error('not found'), { status: 404 });
              }
              return { status: 204 };
            }
            if (route === 'GET /orgs/{org}/memberships/{username}') {
              if (params.org !== 'acme' || !admins.has(String(params.username).toLowerCase())) {
                throw Object.assign(new Error('not found'), { status: 404 });
              }
              return { status: 200, data: { role: 'admin', state: 'active' } };
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
        installationIds: opts.githubInstallations ?? [INST],
      }),
      listActivity: async () => [],
      resolveTeamMembers: async (_o, _owner, members) => members,
      fetchConfigSource: async () => ({ found: false, reason: 'no_repo' }),
      getPullRequest: async () => null,
      listPullRequestFiles: async () => [],
      listOpenPullRequestSnapshots: async () => [],
      fetchCodeowners: async () => null,
      createCheckRun: async () => {},
      exchangeWebCode: async (code) => {
        webCodes.push(code);
        return 'ghu_token';
      },
    },
    slack: {
      exchangeCode: async (p) => {
        if (opts.slackFails) throw new ChatDeliveryError('invalid_code', 'bad code');
        slackCalls.push({ code: p.code, redirectUri: p.redirectUri });
        return { teamId: 'T123', teamName: 'Acme Workspace', botToken: 'xoxb-secret' };
      },
    },
    chatFor: async () => null,
    tracker: nullTracker,
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
    app: createApp(deps, { getClientIp: () => '192.0.2.1' }),
    slackCalls,
    webCodes,
    orgMembers,
    admins,
  };
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

async function beginLogin(app: ReturnType<typeof createApp>, next?: string) {
  const res = await app.request(
    `/auth/github/login${next === undefined ? '' : `?next=${encodeURIComponent(next)}`}`,
  );
  const state = new URL(location(res)).searchParams.get('state') ?? '';
  const setCookie = res.headers.get('set-cookie') ?? '';
  const nonce = /sw_login=([^;]+)/.exec(setCookie)?.[1] ?? '';
  return { res, state, setCookie, loginCookie: `sw_login=${nonce}` };
}

const callback = (
  app: ReturnType<typeof createApp>,
  state: string,
  cookie?: string,
  code = 'abc',
) =>
  app.request(`/auth/github/callback?code=${code}&state=${encodeURIComponent(state)}`, {
    headers: cookie ? { cookie } : {},
  });

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

  test('login redirects to github with a signed state and sets the nonce cookie', async () => {
    const { app } = harness();
    const { res, setCookie } = await beginLogin(app, '/setup?installation_id=11');
    expect(res.status).toBe(302);
    const url = new URL(location(res));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sw.test/auth/github/callback');
    expect(url.searchParams.get('state')).toContain('.');
    expect(setCookie).toContain('sw_login=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/auth/github');
    expect(setCookie).toContain('Max-Age=600');
  });

  test('callback creates a web session cookie, clears the nonce and redirects to next', async () => {
    const { app, webCodes } = harness();
    await seed();
    const { state, loginCookie } = await beginLogin(app, '/setup?installation_id=11');
    const res = await callback(app, state, loginCookie);
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/setup?installation_id=11');
    expect(webCodes).toEqual(['abc']);
    const cookies = res.headers.getSetCookie();
    const web = cookies.find((c) => c.startsWith('sw_web=')) ?? '';
    expect(web).toContain('HttpOnly');
    expect(web).toContain('Secure');
    expect(web).toContain('SameSite=Lax');
    expect(web).toContain('Path=/');
    expect(web).toContain('Max-Age=604800');
    const cleared = cookies.find((c) => c.startsWith('sw_login=')) ?? '';
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/auth/github');
    const token = /sw_web=([^;]+)/.exec(web)?.[1] ?? '';
    expect((await resolveSession(db, token, 'web'))?.login).toBe('alice');
  });

  test('callback rejects a tampered state', async () => {
    const { app, webCodes } = harness();
    const { state, loginCookie } = await beginLogin(app);
    const res = await callback(app, `${state}x`, loginCookie);
    expect(res.status).toBe(400);
    expect(webCodes).toEqual([]);
  });

  test('callback rejects a valid state without its cookie or with a different one', async () => {
    const { app, webCodes } = harness();
    await seed();
    const { state } = await beginLogin(app);
    const other = await beginLogin(app);
    for (const cookie of [undefined, other.loginCookie, 'sw_login=']) {
      const res = await callback(app, state, cookie);
      expect(res.status).toBe(400);
      expect(res.headers.getSetCookie().some((c) => c.startsWith('sw_web='))).toBe(false);
    }
    expect(webCodes).toEqual([]);
  });

  test('callback with access_denied renders a friendly page', async () => {
    const { app } = harness();
    const res = await app.request('/auth/github/callback?error=access_denied', {
      headers: { 'accept-language': 'en' },
    });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain('<html');
    expect(html).toContain('Access was denied');
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
      const { state, loginCookie } = await beginLogin(app, next);
      const res = await callback(app, state, loginCookie);
      expect(res.status).toBe(302);
      expect(location(res)).toBe('/');
    });
  }
});

describe('setup page', () => {
  useCleanDb();

  test('a foreign installation and a missing one look the same', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const responses = async (id: number) => {
      const first = await app.request(`/setup?installation_id=${id}`, { headers: { cookie } });
      const after = await app.request(`/setup?installation_id=${id}&resynced=1`, {
        headers: { cookie, 'accept-language': 'en' },
      });
      return {
        firstStatus: first.status,
        firstLocation: location(first).replace(String(id), 'ID'),
        afterStatus: after.status,
        afterBody: await after.text(),
      };
    };
    const foreign = await responses(FOREIGN);
    const missing = await responses(777);
    expect(foreign.firstStatus).toBe(302);
    expect(foreign.afterStatus).toBe(403);
    expect(missing).toEqual(foreign);
  });

  test('setup forbids a member who left the organization', async () => {
    const { app, orgMembers } = harness();
    const { cookie } = await seed();
    orgMembers.delete('alice');
    const res = await app.request(`/setup?installation_id=${INST}&resynced=1`, {
      headers: { cookie },
    });
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

  test('setup says the last valid config stays in use while invalid', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      await setInstallationConfig(db, id, {
        status: 'invalid',
        errors: [{ path: 'teams', message: 'bad' }],
      });
    });
    const en = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(await en.text()).toContain(
      'Standwise keeps using the last valid version until you fix it.',
    );
    const pt = await app.request(`/setup?installation_id=${INST}`, {
      headers: { cookie, 'accept-language': 'pt-BR' },
    });
    expect(await pt.text()).toContain(
      'O Standwise continua usando a última versão válida até você corrigir.',
    );
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

  test('setup renders in pt-BR by Accept-Language and english by default', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const pt = await app.request(`/setup?installation_id=${INST}`, {
      headers: { cookie, 'accept-language': 'pt-BR,pt;q=0.9' },
    });
    expect(await pt.text()).toContain('Conectar Slack');
    const en = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(await en.text()).toContain('Connect Slack');
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
    expect(await res.text()).toContain('Acme Workspace');
  });

  test('a member who is not an admin sees slack read only', async () => {
    const { app, admins } = harness();
    const { cookie } = await seed();
    admins.delete('alice');
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = await res.text();
    expect(html).not.toContain('/connect/slack');
    expect(html).toContain('Only an admin can connect or reconnect Slack.');
  });

  test('a member who is not an admin sees the admin note when slack is connected', async () => {
    const { app, admins } = harness();
    admins.delete('alice');
    const { cookie } = await seed(async (id) => {
      await saveConnection(db, id, 'slack', 'T123', 'xoxb-secret', KEY, 'Acme Workspace');
    });
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: { cookie, 'accept-language': 'pt-BR' },
      })
    ).text();
    expect(html).toContain('Acme Workspace');
    expect(html).not.toContain('/connect/slack');
    expect(html).toContain('Só um admin pode conectar ou reconectar o Slack.');
  });

  test('setup shows the access warning while keeping the configuration', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      await setInstallationAccessWarning(db, id, 'no_access');
    });
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).toContain('Configured.');
    expect(html).toContain('Standwise has no access to the .github repository.');
    expect(html).toContain('Standwise keeps using the current configuration.');
  });

  test('the admin sees reconnect when slack is connected', async () => {
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
    const html = await res.text();
    expect(html).toContain('Reconnect Slack');
    expect(html).toContain(`/connect/slack?installation_id=${INST}`);
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

  test('connect and callback forbid a member who is not an admin', async () => {
    const { app, admins, slackCalls } = harness();
    const { cookie } = await seed();
    const { state } = await startConnect(app, cookie);
    admins.delete('alice');
    const callback = await app.request(
      `/oauth/slack/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    );
    expect(callback.status).toBe(403);
    expect(slackCalls).toEqual([]);
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
    const connect = await app.request(`/connect/slack?installation_id=${INST}&resynced=1`, {
      headers: { cookie },
    });
    expect(connect.status).toBe(403);
  });

  test('connect forbids a foreign installation and requires login', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const forbidden = await app.request(`/connect/slack?installation_id=${FOREIGN}&resynced=1`, {
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
      externalName: 'Acme Workspace',
      secret: 'xoxb-secret',
    });
  });
});

describe('setup right after install', () => {
  useCleanDb();

  test('links an existing installation for a live organization member', async () => {
    const { app } = harness();
    const { cookie, member } = await seed();
    await setMemberInstallations(db, member.id, []);
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await listMemberInstallations(db, member.id)).map((i) => i.installationId)).toEqual([
      INST,
    ]);
  });

  test('redirects once to a resync login when the installation row is missing', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request('/setup?installation_id=777', { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(location(res)).toBe(
      `/auth/github/login?next=${encodeURIComponent('/setup?installation_id=777&resynced=1')}`,
    );
  });

  test('renders a localized pending page instead of looping after the resync', async () => {
    const { app } = harness({ githubInstallations: [INST, 777] });
    await seed();
    const { state, loginCookie } = await beginLogin(app, '/setup?installation_id=777&resynced=1');
    const login = await callback(app, state, loginCookie);
    const cookie = /sw_web=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? '';
    const en = await app.request('/setup?installation_id=777&resynced=1', {
      headers: { cookie, 'accept-language': 'en' },
    });
    expect(en.status).toBe(409);
    expect(await en.text()).toContain('still being processed');
    const pt = await app.request('/setup?installation_id=777&resynced=1', {
      headers: { cookie, 'accept-language': 'pt-BR' },
    });
    expect(pt.status).toBe(409);
    expect(await pt.text()).toContain('ainda está sendo processada');
  });
});

describe('security headers', () => {
  useCleanDb();

  function expectSecure(res: Response) {
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain('unsafe-inline');
    return csp;
  }

  test('the setup page sends the headers and its inline style matches the policy', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const csp = expectSecure(res);
    const html = await res.text();
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style).toContain('font-family');
    const hash = new Bun.CryptoHasher('sha256').update(style).digest('base64');
    expect(csp).toContain(`style-src 'sha256-${hash}'`);
    expect(html).toContain('<form method="post" action="/setup/api-keys">');
  });

  test('error pages send the headers', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const forbidden = await app.request(`/setup?installation_id=${FOREIGN}&resynced=1`, {
      headers: { cookie },
    });
    expect(forbidden.status).toBe(403);
    expectSecure(forbidden);
    const unauthorized = await app.request('/oauth/slack/callback?code=c&state=x');
    expect(unauthorized.status).toBe(401);
    expectSecure(unauthorized);
    const login = await app.request('/auth/github/login');
    expectSecure(login);
  });

  test('the forms still post and redirect on the same origin', async () => {
    const { app } = harness();
    const { cookie, token } = await seed();
    const form = new URLSearchParams({
      installation_id: String(INST),
      name: 'ci',
      scopes: 'teams:read',
      csrf: csrfToken('sess', token),
    });
    const res = await app.request('/setup/api-keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`/setup?installation_id=${INST}`);
    expectSecure(res);
  });
});

describe('web rate limit', () => {
  useCleanDb();

  test('web routes allow 60 requests per minute per ip', async () => {
    const { app } = harness();
    for (let i = 0; i < 60; i++) {
      expect((await app.request('/auth/github/login')).status).toBe(302);
    }
    const limited = await app.request('/setup?installation_id=11', {
      headers: { 'accept-language': 'en' },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect(await limited.text()).toContain('Too many requests');
    expect((await app.request('/connect/slack')).status).toBe(429);
    expect((await app.request('/oauth/slack/callback')).status).toBe(429);
    expect((await app.request('/install.sh')).status).toBe(200);
  });

  test('each setup request counts once', async () => {
    const { app } = harness();
    for (let i = 0; i < 60; i++) {
      expect((await app.request('/setup')).status).not.toBe(429);
    }
    expect((await app.request('/setup')).status).toBe(429);
  });
});

describe('browser error pages', () => {
  useCleanDb();

  test('forbidden renders a localized html page in english and pt-BR', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const en = await app.request(`/setup?installation_id=${FOREIGN}&resynced=1`, {
      headers: { cookie, 'accept-language': 'en' },
    });
    expect(en.status).toBe(403);
    expect(en.headers.get('content-type')).toContain('text/html');
    const enHtml = await en.text();
    expect(enHtml).toContain('<html lang="en"');
    expect(enHtml).toContain('You do not have access');
    const pt = await app.request(`/setup?installation_id=${FOREIGN}&resynced=1`, {
      headers: { cookie, 'accept-language': 'pt-BR' },
    });
    expect(pt.status).toBe(403);
    const ptHtml = await pt.text();
    expect(ptHtml).toContain('<html lang="pt-BR"');
    expect(ptHtml).toContain('Você não tem acesso');
  });

  test('slack access_denied renders a friendly page', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request('/oauth/slack/callback?error=access_denied', {
      headers: { cookie, 'accept-language': 'en' },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Access was denied');
  });

  test('missing session on the slack callback renders html', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/slack/callback?code=c&state=x');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('slack exchange failure renders a friendly page', async () => {
    const { app } = harness({ slackFails: true });
    const { cookie } = await seed();
    const started = await app.request(`/connect/slack?installation_id=${INST}`, {
      headers: { cookie },
    });
    const state = new URL(location(started)).searchParams.get('state') ?? '';
    const res = await app.request(
      `/oauth/slack/callback?code=c&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie, 'accept-language': 'en' },
      },
    );
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('Slack');
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
  });

  test('the v1 api keeps json errors', async () => {
    const { app } = harness();
    const res = await app.request('/v1/draft');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });
});

describe('escaping', () => {
  useCleanDb();

  test('config errors are html escaped', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      await setInstallationConfig(db, id, {
        status: 'invalid',
        errors: [{ path: '"><img src=x>', message: '<script>alert(1)</script>' }],
      });
    });
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt;');
  });

  test('the page uses a system font stack and no external font host', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain('-apple-system');
  });
});

describe('install script', () => {
  test('is served as a shell script', async () => {
    const { app } = harness();
    const res = await app.request('/install.sh');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/x-shellscript');
    const body = await res.text();
    expect(body).toBe(await Bun.file(`${import.meta.dir}/../../../scripts/install.sh`).text());
    expect(body.startsWith('#!/bin/sh\n')).toBe(true);
  });

  test('downloads only over https with curl and with wget', async () => {
    const body = await Bun.file(`${import.meta.dir}/../../../scripts/install.sh`).text();
    expect(body).toContain("curl --proto '=https' --tlsv1.2");
    expect(body).toMatch(/download\(\) \{ wget --https-only /);
  });
});
