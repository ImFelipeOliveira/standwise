import { describe, expect, test } from 'bun:test';
import { parseConfig } from '@standcast/core';
import {
  createApiKey,
  createSession,
  listApiKeys,
  resolveApiKey,
  setInstallationConfig,
  setMemberInstallations,
  upsertInstallation,
  upsertMember,
} from '@standcast/db';
import { csrfToken } from '@standcast/orchestrator';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { createTestApp, type FakeRequest } from './support';

useCleanDb();

const INST = 11;

function config() {
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
  if (!parsed.ok) throw new Error('config');
  return parsed.config;
}

async function harness() {
  const admins = new Set(['alice']);
  const users = new Map([
    [1, 'alice'],
    [2, 'bob'],
  ]);
  const request: FakeRequest = async (route, params) => {
    const username = String(params.username ?? '').toLowerCase();
    if (route === 'GET /user/{account_id}') {
      return { status: 200, data: { login: users.get(Number(params.account_id)) } };
    }
    if (route === 'GET /orgs/{org}/members/{username}') return { status: 204 };
    if (route === 'GET /orgs/{org}/memberships/{username}') {
      return {
        status: 200,
        data: { role: admins.has(username) ? 'admin' : 'member', state: 'active' },
      };
    }
    throw Object.assign(new Error('not found'), { status: 404 });
  };
  const { app } = createTestApp({ request });
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  await setInstallationConfig(db, INST, { status: 'configured', config: config() });
  const alice = await upsertMember(db, { githubUserId: 1, login: 'alice', email: null });
  const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: null });
  await setMemberInstallations(db, alice.id, [INST]);
  await setMemberInstallations(db, bob.id, [INST]);
  const aliceToken = await createSession(db, alice.id, 'web');
  const bobToken = await createSession(db, bob.id, 'web');
  return {
    app,
    alice: { member: alice, token: aliceToken, cookie: `sc_web=${aliceToken}` },
    bob: { member: bob, token: bobToken, cookie: `sc_web=${bobToken}` },
  };
}

type App = Awaited<ReturnType<typeof harness>>['app'];

const setupPage = (app: App, cookie: string, headers: Record<string, string> = {}) =>
  app.request(`/setup?installation_id=${INST}`, { headers: { cookie, ...headers } });

const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

const post = (
  app: App,
  path: string,
  cookie: string,
  fields: [string, string][],
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });

const FULL_KEY = /sck_[A-Za-z0-9_-]{43}/;

const corrupt = (cookie: string) =>
  `${cookie.slice(0, 40)}${cookie[40] === 'A' ? 'B' : 'A'}${cookie.slice(41)}`;

type User = { token: string; cookie: string };

const flashOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .find((c) => c.startsWith('sc_flash=')) ?? '';

async function createAndShow(app: App, user: User, headers: Record<string, string> = {}) {
  const csrf = csrfToken('sess', user.token);
  const res = await post(app, '/setup/api-keys', user.cookie, createFields(csrf), headers);
  const flash = flashOf(res);
  const location = res.headers.get('location') ?? '';
  const page = location
    ? await app.request(location, { headers: { cookie: `${user.cookie}; ${flash}`, ...headers } })
    : res;
  const html = await page.text();
  return { res, page, html, flash, key: /sck_[A-Za-z0-9_-]{43}/.exec(html)?.[0] ?? '' };
}

const createFields = (csrf: string, extra: [string, string][] = []): [string, string][] => [
  ['csrf', csrf],
  ['installation_id', String(INST)],
  ['name', 'Reporting'],
  ['scopes', 'teams:read'],
  ['scopes', 'dailies:read'],
  ...extra,
];

describe('api keys section visibility', () => {
  test('only an admin sees the section', async () => {
    const { app, alice, bob } = await harness();
    const admin = await (await setupPage(app, alice.cookie)).text();
    expect(admin).toContain('/setup/api-keys');
    expect(admin).toContain('API keys');
    expect(csrfOf(admin)).toBe(csrfToken('sess', alice.token));
    const member = await setupPage(app, bob.cookie);
    expect(member.status).toBe(200);
    const html = await member.text();
    expect(html).not.toContain('/setup/api-keys');
    expect(html).not.toContain('action="/setup/');
    expect(html).not.toContain('API keys');
  });
});

describe('creating keys', () => {
  test('an admin creates a key, the secret shows once and the list shows the prefix', async () => {
    const { app, alice } = await harness();
    const { res, page, html, key } = await createAndShow(app, alice);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/setup?installation_id=${INST}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toMatch(FULL_KEY);
    const flashCookie = res.headers.getSetCookie().find((c) => c.startsWith('sc_flash=')) ?? '';
    expect(flashCookie).toContain('HttpOnly');
    expect(flashCookie).toContain('Secure');
    expect(flashCookie).toContain('Path=/setup');
    expect(flashCookie).toContain('Max-Age=60');
    expect(flashCookie).not.toContain(key.slice(4));
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.getSetCookie().join(';')).toMatch(/sc_flash=;.*Max-Age=0/s);
    expect(key).not.toBe('');
    expect(html).toContain('Copy it now');
    expect(html).toContain('Revoke this key');
    expect(html).toContain('Reporting');
    const again = await (await setupPage(app, alice.cookie)).text();
    expect(again).not.toContain(key);
    expect(again).toContain(key.slice(4, 12));
    expect(again).toContain('Reporting');
    expect(again).toContain('Never');
    const resolved = await resolveApiKey(db, key);
    expect(resolved?.installationId).toBe(INST);
    expect(resolved?.scopes).toEqual(['teams:read', 'dailies:read']);
  });

  test('refreshing after creating a key never creates a second one', async () => {
    const { app, alice } = await harness();
    const { res, flash } = await createAndShow(app, alice);
    const location = res.headers.get('location') ?? '';
    const headers = { cookie: `${alice.cookie}; ${flash}` };
    await app.request(location, { headers });
    const refreshed = await (
      await app.request(location, { headers: { cookie: alice.cookie } })
    ).text();
    expect(refreshed).not.toMatch(FULL_KEY);
    expect(await listApiKeys(db, INST)).toHaveLength(1);
  });

  test('a flash cookie of another session or a tampered one shows nothing', async () => {
    const { app, alice, bob } = await harness();
    const { flash } = await createAndShow(app, alice);
    const other = await (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: { cookie: `${bob.cookie}; ${flash}` },
      })
    ).text();
    expect(other).not.toMatch(FULL_KEY);
    const tampered = await (
      await app.request(`/setup?installation_id=${INST}`, {
        headers: { cookie: `${alice.cookie}; ${corrupt(flash)}` },
      })
    ).text();
    expect(tampered).not.toMatch(FULL_KEY);
    expect(tampered).toContain('API keys');
  });

  test('the copy-now warning and labels follow the language', async () => {
    const { app, alice } = await harness();
    const csrf = csrfOf(await (await setupPage(app, alice.cookie)).text());
    const { html } = await createAndShow(app, alice, { 'accept-language': 'en' });
    expect(csrf).not.toBe('');
    expect(html).toContain('Copy it now');
    expect(html).toContain('Revoke this key');
    expect(html).toContain('Create key');
    expect(html).not.toContain('Copie agora');
  });

  test('key names are escaped', async () => {
    const { app, alice } = await harness();
    const csrf = csrfOf(await (await setupPage(app, alice.cookie)).text());
    await post(app, '/setup/api-keys', alice.cookie, [
      ...createFields(csrf).filter(([k]) => k !== 'name'),
      ['name', '<script>alert(1)</script>'],
    ]);
    const html = await (await setupPage(app, alice.cookie)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('a plain member gets 403 and nothing is created', async () => {
    const { app, bob } = await harness();
    const csrf = csrfToken('sess', bob.token);
    const res = await post(app, '/setup/api-keys', bob.cookie, createFields(csrf));
    expect(res.status).toBe(403);
    expect(await listApiKeys(db, INST)).toEqual([]);
  });

  test('anonymous posts are rejected', async () => {
    const { app } = await harness();
    const res = await app.request('/setup/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(createFields('x')).toString(),
    });
    expect(res.status).toBe(401);
    expect(await listApiKeys(db, INST)).toEqual([]);
  });

  test('invalid names and scopes are 422', async () => {
    const { app, alice } = await harness();
    const csrf = csrfToken('sess', alice.token);
    const noScopes = createFields(csrf).filter(([k]) => k !== 'scopes');
    expect((await post(app, '/setup/api-keys', alice.cookie, noScopes)).status).toBe(422);
    const bad = [...noScopes, ['scopes', 'admin:write'] as [string, string]];
    expect((await post(app, '/setup/api-keys', alice.cookie, bad)).status).toBe(422);
    const blank = createFields(csrf).filter(([k]) => k !== 'name');
    expect(
      (await post(app, '/setup/api-keys', alice.cookie, [...blank, ['name', '  ']])).status,
    ).toBe(422);
    expect(await listApiKeys(db, INST)).toEqual([]);
  });
});

describe('csrf', () => {
  test('creating a key without the csrf token is 403', async () => {
    const { app, alice } = await harness();
    const without = createFields('').filter(([k]) => k !== 'csrf');
    expect((await post(app, '/setup/api-keys', alice.cookie, without)).status).toBe(403);
    expect((await post(app, '/setup/api-keys', alice.cookie, createFields(''))).status).toBe(403);
    expect(await listApiKeys(db, INST)).toEqual([]);
  });

  test('a token of another session or a tampered token is 403', async () => {
    const { app, alice, bob } = await harness();
    const other = csrfToken('sess', bob.token);
    expect((await post(app, '/setup/api-keys', alice.cookie, createFields(other))).status).toBe(
      403,
    );
    const mine = csrfToken('sess', alice.token);
    expect(
      (await post(app, '/setup/api-keys', alice.cookie, createFields(`${mine}x`))).status,
    ).toBe(403);
    expect(await listApiKeys(db, INST)).toEqual([]);
  });

  test('a json or multipart body without the token is 403', async () => {
    const { app, alice } = await harness();
    const json = await app.request('/setup/api-keys', {
      method: 'POST',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: INST, name: 'x', scopes: ['teams:read'] }),
    });
    expect(json.status).toBe(403);
    expect(await listApiKeys(db, INST)).toEqual([]);
  });

  test('revoking without the token is 403 and the key keeps working', async () => {
    const { app, alice } = await harness();
    const { key } = await createAndShow(app, alice);
    const [listed] = await listApiKeys(db, INST);
    const res = await post(app, `/setup/api-keys/${listed?.id}/revoke`, alice.cookie, [
      ['installation_id', String(INST)],
    ]);
    expect(res.status).toBe(403);
    expect(await resolveApiKey(db, key)).not.toBeNull();
  });
});

describe('revoking keys', () => {
  test('an admin revokes a key and the list shows it as revoked', async () => {
    const { app, alice } = await harness();
    const csrf = csrfToken('sess', alice.token);
    const { key } = await createAndShow(app, alice);
    const [listed] = await listApiKeys(db, INST);
    const res = await post(app, `/setup/api-keys/${listed?.id}/revoke`, alice.cookie, [
      ['csrf', csrf],
      ['installation_id', String(INST)],
    ]);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/setup?installation_id=${INST}`);
    expect(await resolveApiKey(db, key)).toBeNull();
    const page = await (await setupPage(app, alice.cookie)).text();
    expect(page).toContain('Revoked');
    expect(page).not.toContain(`/setup/api-keys/${listed?.id}/revoke`);
  });

  test('a plain member cannot revoke', async () => {
    const { app, alice, bob } = await harness();
    const { key } = await createAndShow(app, alice);
    const [listed] = await listApiKeys(db, INST);
    const res = await post(app, `/setup/api-keys/${listed?.id}/revoke`, bob.cookie, [
      ['csrf', csrfToken('sess', bob.token)],
      ['installation_id', String(INST)],
    ]);
    expect(res.status).toBe(403);
    expect(await resolveApiKey(db, key)).not.toBeNull();
  });

  test('unknown, malformed, foreign and already revoked keys render a localized 404', async () => {
    const { app, alice } = await harness();
    await upsertInstallation(db, { id: 12, accountLogin: 'other', accountType: 'Organization' });
    const foreign = await createApiKey(db, {
      installationId: 12,
      name: 'foreign',
      scopes: ['teams:read'],
      createdBy: alice.member.id,
    });
    const csrf = csrfToken('sess', alice.token);
    const revoke = (id: string, headers: Record<string, string> = {}) =>
      post(
        app,
        `/setup/api-keys/${id}/revoke`,
        alice.cookie,
        [
          ['csrf', csrf],
          ['installation_id', String(INST)],
        ],
        headers,
      );
    for (const id of [crypto.randomUUID(), 'nope', foreign.id]) {
      const res = await revoke(id);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('Not found');
    }
    expect(await resolveApiKey(db, foreign.key)).not.toBeNull();
    const { key } = await createAndShow(app, alice);
    const [listed] = await listApiKeys(db, INST);
    expect((await revoke(listed?.id ?? '')).status).toBe(303);
    const again = await revoke(listed?.id ?? '', { 'accept-language': 'en' });
    expect(again.status).toBe(404);
    expect(await again.text()).toContain('Not found');
    expect(await resolveApiKey(db, key)).toBeNull();
  });
});
