import { describe, expect, test } from 'bun:test';
import { parseConfig } from '@standwise/core';
import {
  createSession,
  listApiKeys,
  resolveApiKey,
  setInstallationConfig,
  setMemberInstallations,
  upsertInstallation,
  upsertMember,
} from '@standwise/db';
import { csrfToken } from '@standwise/orchestrator';
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
    alice: { member: alice, token: aliceToken, cookie: `sw_web=${aliceToken}` },
    bob: { member: bob, token: bobToken, cookie: `sw_web=${bobToken}` },
  };
}

type App = Awaited<ReturnType<typeof harness>>['app'];

const setupPage = (app: App, cookie: string, headers: Record<string, string> = {}) =>
  app.request(`/setup?installation_id=${INST}`, { headers: { cookie, ...headers } });

const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

const post = (app: App, path: string, cookie: string, fields: [string, string][]) =>
  app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

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
    expect(html).not.toContain('name="csrf"');
    expect(html).not.toContain('API keys');
  });
});

describe('creating keys', () => {
  test('an admin creates a key, the secret shows once and the list shows the prefix', async () => {
    const { app, alice } = await harness();
    const csrf = csrfOf(await (await setupPage(app, alice.cookie)).text());
    const res = await post(app, '/setup/api-keys', alice.cookie, createFields(csrf));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    const key = /swk_[A-Za-z0-9_-]{43}/.exec(html)?.[0] ?? '';
    expect(key).not.toBe('');
    expect(html).toContain('Copie agora');
    expect(html).toContain('Reporting');
    const again = await (await setupPage(app, alice.cookie)).text();
    expect(again).not.toContain(key);
    expect(again).toContain(key.slice(4, 12));
    expect(again).toContain('Reporting');
    expect(again).toContain('Nunca');
    const resolved = await resolveApiKey(db, key);
    expect(resolved?.installationId).toBe(INST);
    expect(resolved?.scopes).toEqual(['teams:read', 'dailies:read']);
  });

  test('the copy-now warning and labels follow the language', async () => {
    const { app, alice } = await harness();
    const csrf = csrfOf(await (await setupPage(app, alice.cookie)).text());
    const res = await app.request('/setup/api-keys', {
      method: 'POST',
      headers: {
        cookie: alice.cookie,
        'accept-language': 'en',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(createFields(csrf)).toString(),
    });
    const html = await res.text();
    expect(html).toContain('Copy it now');
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
    const csrf = csrfToken('sess', alice.token);
    const html = await (
      await post(app, '/setup/api-keys', alice.cookie, createFields(csrf))
    ).text();
    const key = /swk_[A-Za-z0-9_-]{43}/.exec(html)?.[0] ?? '';
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
    const html = await (
      await post(app, '/setup/api-keys', alice.cookie, createFields(csrf))
    ).text();
    const key = /swk_[A-Za-z0-9_-]{43}/.exec(html)?.[0] ?? '';
    const [listed] = await listApiKeys(db, INST);
    const res = await post(app, `/setup/api-keys/${listed?.id}/revoke`, alice.cookie, [
      ['csrf', csrf],
      ['installation_id', String(INST)],
    ]);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/setup?installation_id=${INST}`);
    expect(await resolveApiKey(db, key)).toBeNull();
    const page = await (await setupPage(app, alice.cookie)).text();
    expect(page).toContain('Revogada');
    expect(page).not.toContain(`/setup/api-keys/${listed?.id}/revoke`);
  });

  test('a plain member cannot revoke', async () => {
    const { app, alice, bob } = await harness();
    const csrf = csrfToken('sess', alice.token);
    const html = await (
      await post(app, '/setup/api-keys', alice.cookie, createFields(csrf))
    ).text();
    const key = /swk_[A-Za-z0-9_-]{43}/.exec(html)?.[0] ?? '';
    const [listed] = await listApiKeys(db, INST);
    const res = await post(app, `/setup/api-keys/${listed?.id}/revoke`, bob.cookie, [
      ['csrf', csrfToken('sess', bob.token)],
      ['installation_id', String(INST)],
    ]);
    expect(res.status).toBe(403);
    expect(await resolveApiKey(db, key)).not.toBeNull();
  });
});
