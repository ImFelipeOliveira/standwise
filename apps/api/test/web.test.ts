import { describe, expect, test } from 'bun:test';
import { parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  claimDelivery,
  createSession,
  failDelivery,
  getConnection,
  listMemberInstallations,
  markConnectionInvalid,
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
import { fakeLinear } from '../../../packages/orchestrator/test/use-cases/fakes';
import { createApp } from '../src/app';
import { PAGE_CSS } from '../src/web/layout';

const KEY = new Uint8Array(32).fill(7);
const INST = 11;
const FOREIGN = 12;

function config(extra = '', members = '[alice, bob]'): StandwiseConfig {
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

function harness(
  opts: { hasConfigRepo?: boolean; slackFails?: boolean; githubInstallations?: number[] } = {},
) {
  const slackCalls: { code: string; redirectUri: string }[] = [];
  const webCodes: string[] = [];
  const orgMembers = new Set(['alice']);
  const orgs = new Set(['acme']);
  const admins = new Set(['alice']);
  const linear = fakeLinear();
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
              if (
                !orgs.has(String(params.org)) ||
                !orgMembers.has(String(params.username).toLowerCase())
              ) {
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
      resolveTeamMembers: async (_o, _owner, members) => ({
        logins: members,
        missingTeams: members.filter((m) => m.startsWith('@gone/')),
        truncatedTeams: members.filter((m) => m.startsWith('@huge/')),
      }),
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
    linear: linear.deps,
    chatFor: async () => null,
    trackerFor: async () => nullTracker,
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
      linearClientId: 'lid',
      linearClientSecret: 'lsecret',
    },
  };
  return {
    app: createApp(deps, { getClientIp: () => '192.0.2.1' }),
    linear,
    slackCalls,
    webCodes,
    orgMembers,
    orgs,
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

describe('setup header', () => {
  useCleanDb();

  const get = (app: ReturnType<typeof createApp>, cookie: string, id: number, lang = 'en') =>
    app.request(`/setup?installation_id=${id}`, {
      headers: { cookie, 'accept-language': lang },
    });

  test('a member with one installation sees the owner as text and no select', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const html = await (await get(app, cookie, INST)).text();
    expect(html).toContain('<header class="topbar">');
    expect(html).toContain('acme');
    expect(html).not.toContain('<select');
  });

  test('a member with two installations gets a switcher with the current one selected', async () => {
    const { app, orgs } = harness();
    orgs.add('other');
    const { cookie, member } = await seed();
    await setMemberInstallations(db, member.id, [INST, FOREIGN]);
    const html = await (await get(app, cookie, INST)).text();
    expect(html).toContain('<form method="get" action="/setup"');
    expect(html).toContain('<select name="installation_id"');
    expect(html).toMatch(new RegExp(`<option value="${INST}" selected(="")?>acme</option>`));
    expect(html).toContain(`<option value="${FOREIGN}">other</option>`);
    expect(html).toContain('<button type="submit"');
    expect(html).toContain('>Go<');
    const pt = await (await get(app, cookie, INST, 'pt-BR')).text();
    expect(pt).toContain('>Ir<');
  });

  test('opening the other installation shows the other organization', async () => {
    const { app, orgs } = harness();
    orgs.add('other');
    const { cookie, member } = await seed();
    await setMemberInstallations(db, member.id, [INST, FOREIGN]);
    const res = await get(app, cookie, FOREIGN);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(
      new RegExp(`<option value="${FOREIGN}" selected(="")?>other</option>`),
    );
  });

  test('an installation the member is not linked to stays forbidden', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await get(app, cookie, FOREIGN);
    expect(res.status).toBe(302);
  });

  test('docs and sign out links appear in en and pt-BR', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const en = await (await get(app, cookie, INST)).text();
    expect(en).toContain('<a href="/docs/"');
    expect(en).toContain('Docs');
    expect(en).toContain('Sign out');
    const pt = await (await get(app, cookie, INST, 'pt-BR')).text();
    expect(pt).toContain('<a href="/docs/pt-BR/"');
    expect(pt).toContain('Docs');
    expect(pt).toContain('Sair');
  });

  test('error pages keep the simple header', async () => {
    const { app } = harness();
    const res = await app.request('/setup?installation_id=1&resynced=1', {
      headers: { 'accept-language': 'en' },
    });
    const html = await res.text();
    expect(html).not.toContain('action="/logout"');
    expect(html).not.toContain('/docs/');
  });
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
    const { cookie } = await seed(async (id) => {
      await setInstallationConfig(db, id, { status: 'unconfigured', reason: 'no_file' });
    });
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    const html = (await res.text()).replaceAll('&amp;', '&');
    expect(html).toContain(
      'https://github.com/acme/.github/new/trunk?filename=standwise.yml&value=',
    );
    expect(html).toContain('help@sw.test');
  });

  test('setup links to repo creation when .github is missing', async () => {
    const { app } = harness({ hasConfigRepo: false });
    const { cookie } = await seed(async (id) => {
      await setInstallationConfig(db, id, { status: 'unconfigured', reason: 'no_repo' });
    });
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
    expect(html).toContain('Digest');
  });

  test('setup groups person failures with translated kinds', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      for (const [kind, subject, error] of [
        ['reminder', 'bob', 'no_chat_identity: bob'],
        ['blocker_route', 'daily-9:abc:mgr', 'no_chat_identity: mgr'],
        ['blocker_route', 'daily-8:def:mgr', 'no_chat_identity: mgr'],
      ] as const) {
        const key = { installationId: id, teamName: '', date: '2026-10-28', kind, subject };
        const claim = await claimDelivery(db, key);
        if (claim.status !== 'claimed') throw new Error('not claimed');
        await failDelivery(db, key, claim.token, error);
      }
    });
    const en = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(en).toContain('Reminder');
    expect(en).toContain('Blocker routing');
    expect(en).toContain('no_chat_identity: mgr');
    expect(en).not.toContain('daily-9');
    const pt = await (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: { cookie, 'accept-language': 'pt-BR' },
      })
    ).text();
    expect(pt).toContain('Lembrete');
    expect(pt).toContain('Encaminhamento de impedimento');
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
    expect(html).toContain('>Configured<');
    expect(html).toContain('Standwise has no access to the .github repository.');
    expect(html).toContain('Standwise keeps using the current configuration.');
  });

  test('a configured install shows its teams, the edit link and the progress', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const en = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(en).toContain('2 of 3 steps done');
    expect(en).toContain('<h3>Alpha</h3>');
    expect(en).toContain('#alpha');
    expect(en).toContain('reminder 09:00 · digest 10:00');
    expect(en).toContain('href="https://github.com/acme/.github/blob/trunk/standwise.yml"');
    expect(en).toContain('Edit on GitHub');
    expect(en).not.toContain('filename=standwise.yml');
    const pt = await (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: { cookie, 'accept-language': 'pt-BR' },
      })
    ).text();
    expect(pt).toContain('2 de 3 etapas concluídas');
    expect(pt).toContain('Editar no GitHub');
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
      externalKey: null,
      secret: 'xoxb-secret',
      invalidatedAt: null,
    });
  });
});

describe('linear connection', () => {
  useCleanDb();

  const tracker = (provider: string) => async (id: number) => {
    await setInstallationConfig(db, id, {
      status: 'configured',
      config: config(`    tracker: { provider: ${provider}, team: ENG }`),
    });
  };

  async function startConnect(app: ReturnType<typeof createApp>, cookie: string) {
    const res = await app.request(`/connect/linear?installation_id=${INST}`, {
      headers: { cookie },
    });
    return { res, state: new URL(location(res)).searchParams.get('state') ?? '' };
  }

  test('connect redirects to linear with a signed state', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const { res, state } = await startConnect(app, cookie);
    expect(res.status).toBe(302);
    const url = new URL(location(res));
    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize');
    expect(url.searchParams.get('actor')).toBe('app');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sw.test/oauth/linear/callback');
    expect(state).toContain('.');
  });

  test('connect without a session goes to login', async () => {
    const { app } = harness();
    await seed();
    const res = await app.request(`/connect/linear?installation_id=${INST}`);
    expect(res.status).toBe(302);
    expect(location(res)).toContain('/auth/github/login');
  });

  test('callback saves the workspace and returns to setup', async () => {
    const { app, linear } = harness();
    const { cookie } = await seed();
    const { state } = await startConnect(app, cookie);
    const res = await app.request(
      `/oauth/linear/callback?code=c1&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`/setup?installation_id=${INST}`);
    expect(linear.calls.exchanges.map((e) => e.code)).toEqual(['c1']);
    expect(await getConnection(db, INST, 'linear', KEY)).toMatchObject({
      externalId: 'org-1',
      externalName: 'Acme Linear',
      externalKey: 'acme',
    });
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).toContain('Connected to the Acme Linear workspace.');
    expect(html).toContain('Reconnect Linear');
    expect(html).toContain(`/connect/linear?installation_id=${INST}`);
  });

  test('callback rejects a state started by another session', async () => {
    const { app, linear } = harness();
    const { cookie, member } = await seed();
    const { state } = await startConnect(app, cookie);
    const other = `sw_web=${await createSession(db, member.id, 'web')}`;
    const res = await app.request(
      `/oauth/linear/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie: other } },
    );
    expect(res.status).toBe(400);
    expect(linear.calls.exchanges).toEqual([]);
    expect(await getConnection(db, INST, 'linear', KEY)).toBeNull();
  });

  test('linear access_denied renders a friendly page', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request('/oauth/linear/callback?error=access_denied', {
      headers: { cookie, 'accept-language': 'en' },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Access was denied');
  });

  test('a failed exchange renders a friendly page', async () => {
    const { app, linear } = harness();
    linear.state.exchangeError = new Error('linear oauth http 500');
    const { cookie } = await seed();
    const { state } = await startConnect(app, cookie);
    const res = await app.request(
      `/oauth/linear/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie, 'accept-language': 'pt-BR' } },
    );
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('Falha ao conectar o Linear');
  });

  test('the admin sees connect linear when nothing is connected', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).toContain('Connect Linear');
    expect(html).toContain(`/connect/linear?installation_id=${INST}`);
  });

  test('a member who is not an admin cannot connect linear', async () => {
    const { app, admins } = harness();
    admins.delete('alice');
    const { cookie } = await seed(async (id) => {
      await saveConnection(db, id, 'linear', 'org-1', '{}', KEY, 'Acme Linear', 'acme');
    });
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).toContain('Acme Linear');
    expect(html).not.toContain('/connect/linear');
    expect(html).toContain('Only an admin can connect or reconnect Linear.');
  });

  test('an invalid connection asks to reconnect', async () => {
    const { app } = harness();
    const { cookie } = await seed(async (id) => {
      await saveConnection(db, id, 'linear', 'org-1', '{}', KEY, 'Acme Linear', 'acme');
      await markConnectionInvalid(db, id, 'linear');
    });
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).toContain('The connection to the Acme Linear workspace stopped working.');
    expect(html).toContain('Reconnect Linear');
  });

  test('warns when a team uses linear and linear is not connected', async () => {
    const { app } = harness();
    const { cookie } = await seed(tracker('linear'));
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } })
    ).text();
    expect(html).toContain(
      'This team uses Linear, but Linear is not connected to this installation yet.',
    );
  });

  test('says jira is coming soon when a team uses jira', async () => {
    const { app } = harness();
    const { cookie } = await seed(tracker('jira'));
    const html = await (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: { cookie, 'accept-language': 'pt-BR' },
      })
    ).text();
    expect(html).toContain('A integração com o Jira ainda não está disponível.');
    expect(html).not.toContain('Linear ainda não está conectado');
  });
});

describe('setup github team notices', () => {
  useCleanDb();

  const withTeams = async (id: number) => {
    await setInstallationConfig(db, id, {
      status: 'configured',
      config: config('', '[alice, "@gone/ops", "@huge/all"]'),
    });
  };

  const page = async (setup: (id: number) => Promise<void>, lang?: string) => {
    const { app } = harness();
    const { cookie } = await seed(setup);
    return (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: lang ? { cookie, 'accept-language': lang } : { cookie },
      })
    ).text();
  };

  test('shows a notice for a missing and a truncated team in english', async () => {
    const html = await page(withTeams);
    expect(html).toContain(
      'Team Alpha: the GitHub team @gone/ops was not found, or Standwise cannot see it.',
    );
    expect(html).toContain(
      'Team Alpha: the GitHub team @huge/all is too large; only the first 5,000 members are used.',
    );
  });

  test('shows the notices in pt-BR', async () => {
    const html = await page(withTeams, 'pt-BR');
    expect(html).toContain('Time Alpha: o time @gone/ops do GitHub não foi encontrado');
    expect(html).toContain('Time Alpha: o time @huge/all do GitHub é grande demais');
  });

  test('shows no notice when every team resolves', async () => {
    const html = await page(async () => {});
    expect(html).not.toContain('was not found, or Standwise cannot see it');
    expect(html).not.toContain('is too large');
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
    expect(style).toBe(PAGE_CSS);
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

describe('web logout', () => {
  useCleanDb();

  const post = (app: ReturnType<typeof harness>['app'], cookie: string, body: URLSearchParams) =>
    app.request('/logout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

  test('revokes the session, clears the cookie and redirects', async () => {
    const { app } = harness();
    const { cookie, token } = await seed();
    const res = await post(app, cookie, new URLSearchParams({ csrf: csrfToken('sess', token) }));
    expect(res.status).toBe(303);
    expect(location(res)).toBe('/');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('sw_web=;');
    expect(setCookie).toContain('Path=/');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
    const after = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(after.status).toBe(302);
    expect(location(after)).toContain('/auth/github/login');
  });

  test('rejects a post without a valid csrf token and keeps the session', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await post(app, cookie, new URLSearchParams({ csrf: 'forged' }));
    expect(res.status).toBe(403);
    const after = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(after.status).toBe(200);
  });

  test('without a session or with a revoked one it still clears and redirects', async () => {
    const { app } = harness();
    const none = await app.request('/logout', { method: 'POST' });
    expect(none.status).toBe(303);
    expect(location(none)).toBe('/');
    const { cookie, token } = await seed();
    const body = new URLSearchParams({ csrf: csrfToken('sess', token) });
    await post(app, cookie, body);
    const again = await post(app, cookie, body);
    expect(again.status).toBe(303);
    expect(again.headers.get('set-cookie') ?? '').toContain('sw_web=;');
  });

  test('a post without a cookie does not touch cookies', async () => {
    const { app } = harness();
    const res = await app.request('/logout', { method: 'POST' });
    expect(res.status).toBe(303);
    expect(location(res)).toBe('/');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('a cross-site post is rejected and keeps the session', async () => {
    const { app } = harness();
    const { cookie, token } = await seed();
    const res = await app.request('/logout', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
      },
      body: new URLSearchParams({ csrf: csrfToken('sess', token) }).toString(),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('sw_web=;');
    const after = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(after.status).toBe(200);
  });

  test('a same-origin post with a valid token still signs out', async () => {
    const { app } = harness();
    const { cookie, token } = await seed();
    const res = await app.request('/logout', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
      },
      body: new URLSearchParams({ csrf: csrfToken('sess', token) }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie') ?? '').toContain('sw_web=;');
  });

  test('the setup page shows a sign out button in en and pt-BR', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const en = await app.request(`/setup?installation_id=${INST}`, {
      headers: { cookie, 'accept-language': 'en' },
    });
    const enHtml = await en.text();
    expect(enHtml).toContain('<form method="post" action="/logout">');
    expect(enHtml).toContain('Sign out');
    const pt = await app.request(`/setup?installation_id=${INST}`, {
      headers: { cookie, 'accept-language': 'pt-BR' },
    });
    expect(await pt.text()).toContain('Sair');
  });

  test('page responses carry hsts with includeSubDomains', async () => {
    const { app } = harness();
    const { cookie } = await seed();
    const res = await app.request(`/setup?installation_id=${INST}`, { headers: { cookie } });
    expect(res.headers.get('strict-transport-security')).toContain('includeSubDomains');
    const login = await app.request('/auth/github/login');
    expect(login.headers.get('strict-transport-security')).toContain('includeSubDomains');
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
    expect(body).toMatch(/download\(\) \{ wget -q -O "\$2" "\$1"; \}/);
    expect(body).not.toContain('--https-only');
    const urls = body.match(/\bhttps?:\/\/[^\s"'<>)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('https://')).toBe(true);
    expect(body).toContain('BASE="https://');
  });
});
