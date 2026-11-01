import { describe, expect, test } from 'bun:test';
import { addCalendarDays, parseConfig } from '@standcast/core';
import {
  type ApiKeyScope,
  claimDelivery,
  completeDelivery,
  createApiKey,
  createSession,
  revokeApiKey,
  setInstallationConfig,
  upsertDaily,
  upsertInstallation,
  upsertMember,
} from '@standcast/db';
import { Ajv2020 } from 'ajv/dist/2020';
import { sql } from 'drizzle-orm';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { createTestApp } from './support';

useCleanDb();

const A = 11;
const B = 12;
const ALL: ApiKeyScope[] = ['teams:read', 'dailies:read', 'digests:read', 'blockers:read'];

function config(team: string, members: string) {
  const parsed = parseConfig(`
teams:
  - name: ${team}
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: ${members}
    chat: { provider: slack, channel: "#t" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

async function seed() {
  await upsertInstallation(db, { id: A, accountLogin: 'acme', accountType: 'Organization' });
  await upsertInstallation(db, { id: B, accountLogin: 'globex', accountType: 'Organization' });
  await setInstallationConfig(db, A, {
    status: 'configured',
    config: config('Alpha', '[alice, bob, carol]'),
  });
  await setInstallationConfig(db, B, {
    status: 'configured',
    config: config('Gamma', '[alice, bob]'),
  });
  const people = [];
  for (const [i, login] of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].entries()) {
    people.push(await upsertMember(db, { githubUserId: i + 1, login, email: null }));
  }
  return people;
}

async function keyFor(installationId: number, scopes: ApiKeyScope[] = ALL) {
  const [alice] = await db.execute(sql`SELECT id FROM members WHERE login = 'alice'`);
  const created = await createApiKey(db, {
    installationId,
    name: 'test',
    scopes,
    createdBy: (alice as { id: string }).id,
  });
  return created;
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

type Json = Record<string, unknown>;
type Page = { data: Json[]; next_cursor: string | null };

async function get(app: ReturnType<typeof createTestApp>['app'], path: string, key?: string) {
  const res = await app.request(path, { headers: key ? bearer(key) : {} });
  return { res, body: (await res.json()) as Json };
}

async function dailyFor(login: string, installationId: number, date: string, blockers = 0) {
  const [row] = await db.execute(sql`SELECT id FROM members WHERE login = ${login}`);
  await upsertDaily(db, {
    installationId,
    memberId: (row as { id: string }).id,
    date,
    payload: {
      org: 'acme',
      yesterday: [{ text: `y ${login}` }],
      today: [{ text: `t ${login}` }],
      blockers: Array.from({ length: blockers }, (_, i) => ({ text: `b ${login} ${i}` })),
    },
    submittedAt: new Date(`${date}T12:00:00Z`),
  });
}

describe('org authentication', () => {
  test('missing, malformed, unknown and revoked keys are 401', async () => {
    await seed();
    const { app } = createTestApp();
    const { id, key } = await keyFor(A);
    for (const path of [
      '/v1/org/teams',
      '/v1/org/dailies',
      '/v1/org/digests',
      '/v1/org/blockers',
    ]) {
      const none = await get(app, path);
      expect(none.res.status).toBe(401);
      expect(none.body).toEqual({
        error: { code: 'unauthorized', message: 'missing or invalid api key' },
      });
      expect((await get(app, path, 'sck_nope')).res.status).toBe(401);
      expect((await get(app, path, 'garbage')).res.status).toBe(401);
    }
    expect((await get(app, '/v1/org/teams', key)).res.status).toBe(200);
    await revokeApiKey(db, A, id);
    expect((await get(app, '/v1/org/teams', key)).res.status).toBe(401);
  });

  test('session tokens and api keys do not mix', async () => {
    const people = await seed();
    const { app } = createTestApp();
    const { key } = await keyFor(A);
    const alice = people[0];
    if (!alice) throw new Error('seed');
    const session = await createSession(db, alice.id, 'cli');
    expect((await get(app, '/v1/org/teams', session)).res.status).toBe(401);
    expect((await get(app, '/v1/draft?org=acme', key)).res.status).toBe(401);
    const submit = await app.request('/v1/dailies', {
      method: 'POST',
      headers: { ...bearer(key), 'content-type': 'application/json' },
      body: JSON.stringify({ org: 'acme', yesterday: [], today: [{ text: 'x' }], blockers: [] }),
    });
    expect(submit.status).toBe(401);
  });

  test('failed key attempts count against the ip, once per limiter', async () => {
    await seed();
    const { app } = createTestApp();
    await get(app, '/v1/org/teams', 'sck_nope');
    const rows = await db.execute(sql`SELECT key FROM rate_limits ORDER BY key`);
    expect(rows.map((r) => (r as { key: string }).key)).toEqual([
      'api:ip:192.0.2.1',
      'authfail:ip:192.0.2.1',
    ]);
  });
});

describe('org scopes', () => {
  test('a key without the scope gets 403 insufficient_scope naming it', async () => {
    await seed();
    const { app } = createTestApp();
    const { key } = await keyFor(A, ['teams:read']);
    expect((await get(app, '/v1/org/teams', key)).res.status).toBe(200);
    const cases: [string, string][] = [
      ['/v1/org/dailies', 'dailies:read'],
      ['/v1/org/dailies/7b1c2f0e-5a0b-4a63-9a43-0d2a1f0f9d11', 'dailies:read'],
      ['/v1/org/digests', 'digests:read'],
      ['/v1/org/blockers', 'blockers:read'],
    ];
    for (const [path, scope] of cases) {
      const { res, body } = await get(app, path, key);
      expect(res.status).toBe(403);
      expect(body).toEqual({
        error: {
          code: 'insufficient_scope',
          message: `api key lacks the ${scope} scope`,
          required_scope: scope,
        },
      });
    }
  });
});

describe('org rate limit', () => {
  test('applies per key, 600 per minute, with headers', async () => {
    await seed();
    const { app } = createTestApp();
    const first = await keyFor(A);
    const second = await keyFor(A);
    const ok = await get(app, '/v1/org/teams', first.key);
    expect(ok.res.headers.get('RateLimit-Limit')).toBe('600');
    expect(ok.res.headers.get('RateLimit-Remaining')).toBe('599');
    await db.execute(sql`
      UPDATE rate_limits SET count = 599 WHERE key = ${`apikey:${first.id}`}
    `);
    expect((await get(app, '/v1/org/teams', first.key)).res.status).toBe(200);
    const blocked = await get(app, '/v1/org/teams', first.key);
    expect(blocked.res.status).toBe(429);
    expect(blocked.res.headers.get('Retry-After')).toBe('55');
    expect(blocked.body).toEqual({
      error: { code: 'rate_limited', message: 'rate limit exceeded' },
    });
    expect((await get(app, '/v1/org/teams', second.key)).res.status).toBe(200);
  });

  test('a rate-limited key is limited before its scope is checked', async () => {
    await seed();
    const { app } = createTestApp();
    const { id, key } = await keyFor(A, ['teams:read']);
    await get(app, '/v1/org/teams', key);
    await db.execute(sql`UPDATE rate_limits SET count = 600 WHERE key = ${`apikey:${id}`}`);
    expect((await get(app, '/v1/org/dailies', key)).res.status).toBe(429);
  });
});

describe('org data', () => {
  test('teams of the key installation', async () => {
    await seed();
    const { app } = createTestApp();
    const { key } = await keyFor(A);
    const { res, body } = await get(app, '/v1/org/teams', key);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      data: [
        {
          name: 'Alpha',
          timezone: 'America/Sao_Paulo',
          workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          remindAt: '09:00',
          digestAt: '10:00',
          memberLogins: ['alice', 'bob', 'carol'],
        },
      ],
      next_cursor: null,
    });
  });

  test('tenant isolation: a key never sees another installation, even asking for its team', async () => {
    await seed();
    const { app } = createTestApp();
    await dailyFor('alice', B, '2026-10-28', 1);
    await dailyFor('bob', A, '2026-10-28');
    const { key } = await keyFor(A);
    const mine = (await get(app, '/v1/org/dailies', key)).body as unknown as Page;
    expect(mine.data.map((d) => d.login)).toEqual(['bob']);
    const foreignTeam = await get(app, '/v1/org/dailies?team=Gamma', key);
    expect(foreignTeam.res.status).toBe(422);
    expect(JSON.stringify(foreignTeam.body)).not.toContain('b alice');
    const blockers = (await get(app, '/v1/org/blockers', key)).body as unknown as Page;
    expect(blockers.data).toEqual([]);
    const other = await keyFor(B);
    const theirs = (await get(app, '/v1/org/dailies', other.key)).body as unknown as Page;
    const foreignId = theirs.data[0]?.id as string;
    expect((await get(app, `/v1/org/dailies/${foreignId}`, key)).res.status).toBe(404);
    expect((await get(app, `/v1/org/dailies/${foreignId}`, other.key)).res.status).toBe(200);
  });

  test('pagination: 120 dailies with limit 50 give 3 pages without repeats or gaps', async () => {
    await seed();
    const { app } = createTestApp();
    const logins = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
    for (let d = 0; d < 20; d++) {
      for (const login of logins) await dailyFor(login, A, addCalendarDays('2026-09-01', d));
    }
    const { key } = await keyFor(A);
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/v1/org/dailies?limit=50${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await get(app, path, key)).body as unknown as Page;
      sizes.push(page.data.length);
      ids.push(...page.data.map((d) => d.id as string));
      cursor = page.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
  });

  test('invalid cursor, limit, date and team are 422 invalid_request', async () => {
    await seed();
    const { app } = createTestApp();
    const { key } = await keyFor(A);
    const bad = [
      '/v1/org/dailies?cursor=garbage',
      '/v1/org/dailies?limit=0',
      '/v1/org/dailies?limit=101',
      '/v1/org/dailies?limit=abc',
      '/v1/org/dailies?date=yesterday',
      '/v1/org/dailies?team=Nope',
      '/v1/org/blockers?cursor=garbage',
      '/v1/org/blockers?limit=1000',
      '/v1/org/digests?cursor=garbage',
      '/v1/org/digests?from=1',
      '/v1/org/dailies/not-a-uuid',
    ];
    for (const path of bad) {
      const { res, body } = await get(app, path, key);
      const expected = path.endsWith('not-a-uuid') ? 404 : 422;
      expect(res.status, path).toBe(expected);
      expect((body.error as Json).code).toBe(expected === 404 ? 'not_found' : 'invalid_request');
    }
  });

  test('an unconfigured installation is 409 org_not_configured', async () => {
    await seed();
    await setInstallationConfig(db, A, { status: 'unconfigured', reason: 'no_file' });
    const { app } = createTestApp();
    const { key } = await keyFor(A);
    const { res, body } = await get(app, '/v1/org/dailies', key);
    expect(res.status).toBe(409);
    expect((body.error as Json).code).toBe('org_not_configured');
  });

  test('digests and blockers over http', async () => {
    await seed();
    const { app } = createTestApp();
    await dailyFor('alice', A, '2026-10-28', 2);
    const delivery = {
      installationId: A,
      teamName: 'Alpha',
      date: '2026-10-28',
      kind: 'digest' as const,
    };
    const claim = await claimDelivery(db, delivery);
    if (claim.status !== 'claimed') throw new Error('claim');
    await completeDelivery(db, delivery, claim.token, { channel: 'C', id: '1' });
    const { key } = await keyFor(A);
    const digests = (await get(app, '/v1/org/digests?team=Alpha', key)).body as unknown as Page;
    expect(digests.data).toEqual([
      {
        team: 'Alpha',
        date: '2026-10-28',
        status: 'sent',
        sentAt: expect.any(String),
        missing: ['bob', 'carol'],
      },
    ]);
    const blockers = (await get(app, '/v1/org/blockers?date=2026-10-28&limit=1', key))
      .body as unknown as Page;
    expect(blockers.data).toHaveLength(1);
    expect(blockers.next_cursor).toEqual(expect.any(String));
    const rest = (await get(app, `/v1/org/blockers?limit=1&cursor=${blockers.next_cursor}`, key))
      .body as unknown as Page;
    expect(rest.data.map((b) => b.text)).toEqual(['b alice 1']);
    expect(rest.next_cursor).toBeNull();
  });
});

type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, Json> }>>;
  components: { schemas: Record<string, Json> };
};

function strictify<T>(node: T): T {
  if (Array.isArray(node)) return node.map((n) => strictify(n)) as T;
  if (typeof node !== 'object' || node === null) return node;
  const copy: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    copy[k] = k === 'example' || k === 'examples' ? v : strictify(v);
  }
  if (copy.type === 'object' || copy.properties) copy.additionalProperties = false;
  return copy as T;
}

describe('published schemas stay permissive', () => {
  test('the public document never declares additionalProperties false', async () => {
    const { app } = createTestApp();
    const text = await (await app.request('/openapi.json')).text();
    expect(text).not.toMatch(/"additionalProperties":\s*false/);
  });
});

describe('org responses match the documented schema', () => {
  test('every response validates against a strict copy of the published schema', async () => {
    await seed();
    const { app } = createTestApp();
    await dailyFor('alice', A, '2026-10-28', 2);
    await dailyFor('bob', A, '2026-10-28', 1);
    const delivery = {
      installationId: A,
      teamName: 'Alpha',
      date: '2026-10-28',
      kind: 'digest' as const,
    };
    const claim = await claimDelivery(db, delivery);
    if (claim.status !== 'claimed') throw new Error('claim');
    await completeDelivery(db, delivery, claim.token, { channel: 'C', id: '1' });
    const { key } = await keyFor(A);
    const list = (await get(app, '/v1/org/dailies', key)).body as unknown as Page;
    const id = list.data[0]?.id as string;
    const doc = (await (await app.request('/openapi.json')).json()) as Doc;
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const operations: [string, string, number][] = [
      ['/v1/org/teams', '/v1/org/teams', 200],
      ['/v1/org/dailies', '/v1/org/dailies', 200],
      ['/v1/org/dailies/{id}', `/v1/org/dailies/${id}`, 200],
      ['/v1/org/digests', '/v1/org/digests', 200],
      ['/v1/org/blockers', '/v1/org/blockers', 200],
      ['/v1/org/dailies', '/v1/org/dailies?limit=0', 422],
      ['/v1/org/dailies/{id}', `/v1/org/dailies/${crypto.randomUUID()}`, 404],
      ['/v1/org/dailies', '/v1/org/dailies', 401],
    ];
    for (const [route, url, status] of operations) {
      const response = doc.paths[route]?.get?.responses[String(status)] as
        | { content: { 'application/json': { schema: Json } } }
        | undefined;
      const schema = response?.content['application/json'].schema;
      expect(schema, `${route} ${status}`).toBeDefined();
      const actual = await app.request(url, { headers: status === 401 ? {} : bearer(key) });
      expect(actual.status, url).toBe(status);
      const validate = ajv.compile(strictify({ ...schema, components: doc.components }));
      const body = await actual.json();
      expect(validate(body), `${url}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
    expect(JSON.stringify(list)).not.toContain('suggestion');
  });
});

describe('org openapi documentation', () => {
  test('org routes are in the public document with apiKey security and every error', async () => {
    const { app } = createTestApp();
    const doc = (await (await app.request('/openapi.json')).json()) as Doc;
    const expected = [
      ['/v1/org/teams', ['200', '401', '403', '409', '422', '429']],
      ['/v1/org/dailies', ['200', '401', '403', '409', '422', '429']],
      ['/v1/org/dailies/{id}', ['200', '401', '403', '404', '409', '422', '429']],
      ['/v1/org/digests', ['200', '401', '403', '409', '422', '429']],
      ['/v1/org/blockers', ['200', '401', '403', '409', '422', '429']],
    ] as const;
    for (const [path, statuses] of expected) {
      const op = doc.paths[path]?.get as unknown as Json & { responses: Json };
      expect(op, path).toBeDefined();
      expect(op.tags).toEqual(['Organization']);
      expect(op.security).toEqual([{ apiKey: [] }]);
      expect(typeof op.summary).toBe('string');
      expect(String(op.description).split('\n\n').length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(op.responses)).toEqual(expect.arrayContaining([...statuses]));
      for (const [status, response] of Object.entries(op.responses)) {
        const json = (
          response as { content?: Record<string, { example?: unknown; examples?: object }> }
        ).content?.['application/json'];
        expect(json?.example ?? json?.examples, `${path} ${status}`).toBeDefined();
      }
    }
    expect(JSON.stringify(doc)).not.toContain('/v1/draft');
  });
});
