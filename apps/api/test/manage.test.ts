import { describe, expect, test } from 'bun:test';
import { parseConfig } from '@standwise/core';
import {
  addMemberInstallation,
  createSession,
  setInstallationConfig,
  upsertDaily,
  upsertInstallation,
  upsertMember,
} from '@standwise/db';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { createTestApp, type FakeRequest } from './support';

useCleanDb();

const INST = 11;
const LOGINS = ['alice', 'bob', 'carol', 'frank'];
const ADMINS = new Set(['frank']);

function config() {
  const parsed = parseConfig(`
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [carol]
    members: [alice, bob]
    chat: { provider: slack, channel: "#backend" }
  - name: platform
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [frank]
    members: [bob]
    chat: { provider: slack, channel: "#platform" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const request: FakeRequest = async (route, params) => {
  if (route === 'GET /user/{account_id}') {
    const login = LOGINS[Number(params.account_id) - 1];
    if (!login) throw notFound();
    return { status: 200, data: { login } };
  }
  if (route === 'GET /orgs/{org}/members/{username}') return { status: 204 };
  if (route === 'GET /orgs/{org}/memberships/{username}') {
    if (!ADMINS.has(String(params.username))) throw notFound();
    return { status: 200, data: { role: 'admin', state: 'active' } };
  }
  throw new Error(route);
};

async function setup() {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  await setInstallationConfig(db, INST, { status: 'configured', config: config() });
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const [i, login] of LOGINS.entries()) {
    const member = await upsertMember(db, { githubUserId: i + 1, login, email: null });
    await addMemberInstallation(db, member.id, INST);
    tokens[login] = await createSession(db, member.id, 'cli');
    ids[login] = member.id;
  }
  const { app } = createTestApp({ request });
  const get = async (login: string | null, path: string) => {
    const token = login ? tokens[login] : undefined;
    const res = await app.request(path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { res, body: (await res.json()) as Record<string, unknown> };
  };
  return { app, get, ids };
}

type Page = { data: Record<string, unknown>[]; next_cursor: string | null };

describe('manage routes', () => {
  test('teams lists only the teams the person can read', async () => {
    const { get } = await setup();
    const names = async (login: string) =>
      ((await get(login, '/v1/manage/teams?org=acme')).body as Page).data.map((t) => t.name);
    expect(await names('carol')).toEqual(['backend']);
    expect(await names('frank')).toEqual(['backend', 'platform']);
    expect(await names('alice')).toEqual([]);
  });

  test('a backend manager reads backend and gets 403 on platform and unknown teams', async () => {
    const { get, ids } = await setup();
    await upsertDaily(db, {
      installationId: INST,
      memberId: ids.bob ?? '',
      date: '2026-10-27',
      payload: {
        org: 'acme',
        yesterday: [{ text: 'shipped' }],
        today: [{ text: 'review' }],
        blockers: [{ text: 'waiting on infra' }],
      },
      submittedAt: new Date('2026-10-27T12:00:00Z'),
    });
    const ok = await get('carol', '/v1/manage/dailies?org=acme&team=backend');
    expect(ok.res.status).toBe(200);
    const page = ok.body as Page;
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      login: 'bob',
      date: '2026-10-27',
      submittedAt: '2026-10-27T12:00:00.000Z',
    });
    expect(page.data[0]).not.toHaveProperty('suggestions');
    const blockers = await get('carol', '/v1/manage/blockers?org=acme&team=backend');
    expect((blockers.body as Page).data.map((b) => b.text)).toEqual(['waiting on infra']);
    for (const team of ['platform', 'ghost']) {
      const denied = await get('carol', `/v1/manage/dailies?org=acme&team=${team}`);
      expect(denied.res.status).toBe(403);
      expect(denied.body).toEqual({
        error: { code: 'forbidden', message: 'you cannot read this team' },
      });
    }
  });

  test('an admin reads both teams and a plain member is forbidden', async () => {
    const { get } = await setup();
    for (const team of ['backend', 'platform']) {
      for (const resource of ['dailies', 'digests', 'blockers']) {
        const path = `/v1/manage/${resource}?org=acme&team=${team}`;
        expect((await get('frank', path)).res.status).toBe(200);
        expect((await get('alice', path)).res.status).toBe(403);
      }
    }
  });

  test('outside the 90-day window is 422 invalid_request', async () => {
    const { get } = await setup();
    const inside = await get(
      'carol',
      '/v1/manage/digests?org=acme&team=backend&from=2026-07-31&to=2026-10-28',
    );
    expect(inside.res.status).toBe(200);
    for (const range of ['from=2026-07-30', 'to=2026-10-29']) {
      const outside = await get('carol', `/v1/manage/digests?org=acme&team=backend&${range}`);
      expect(outside.res.status).toBe(422);
      expect((outside.body.error as { code: string }).code).toBe('invalid_request');
    }
  });

  test('a session is required', async () => {
    const { get } = await setup();
    const res = await get(null, '/v1/manage/teams?org=acme');
    expect(res.res.status).toBe(401);
  });

  test('routes are in the internal document only', async () => {
    const { app, get } = await setup();
    const internal = await get('alice', '/openapi.internal.json');
    const paths = Object.keys((internal.body as { paths: object }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/manage/teams',
        '/v1/manage/digests',
        '/v1/manage/dailies',
        '/v1/manage/blockers',
      ]),
    );
    expect(await (await app.request('/openapi.json')).text()).not.toContain('/v1/manage');
  });
});
