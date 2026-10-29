import { describe, expect, test } from 'bun:test';
import { parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  getIdentities,
  getWebhookDelivery,
  insertWebhookEndpoint,
  listDailies,
  listMemberInstallations,
  resolveSession,
  setInstallationConfig,
  upsertInstallation,
} from '@standwise/db';
import type { Deps } from '@standwise/orchestrator';
import { createMemoryQueue } from '@standwise/queue';
import { ChatDeliveryError } from '@standwise/slack';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { createApp } from '../src/app';

const KEY = new Uint8Array(32).fill(7);
const INST = 11;

function config(extra = ''): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#alpha" }
${extra}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

function outsider(): StandwiseConfig {
  const base = config();
  return { ...base, teams: base.teams.map((t) => ({ ...t, members: ['zed'] })) };
}

type Harness = {
  app: ReturnType<typeof createApp>;
  queue: ReturnType<typeof createMemoryQueue>;
  activityCalls: Date[];
  membershipCalls: string[];
  members: Set<string>;
  setNow: (d: Date) => void;
};

function harness(
  opts: {
    slackUser?: string | null;
    hasSlack?: boolean;
    findUserError?: Error;
    profileError?: unknown;
  } = {},
): Harness {
  const membershipCalls: string[] = [];
  const members = new Set(['alice']);
  const queue = createMemoryQueue();
  const activityCalls: Date[] = [];
  let now = new Date('2026-10-28T15:00:00Z');
  const deps: Deps = {
    db,
    queue,
    now: () => now,
    encryptionKey: KEY,
    github: {
      app: {} as Deps['github']['app'],
      installationOctokit: async () =>
        ({
          request: async (
            route: string,
            params: { org: string; username: string; account_id: number },
          ) => {
            if (route === 'GET /user/{account_id}' && params.account_id === 1) {
              return { status: 200, data: { id: 1, login: 'Alice' } };
            }
            if (route !== 'GET /orgs/{org}/members/{username}') throw new Error(route);
            membershipCalls.push(`${params.org}/${params.username}`);
            if (!members.has(params.username.toLowerCase())) {
              throw Object.assign(new Error('not found'), { status: 404 });
            }
            return { status: 204 };
          },
        }) as never,
      getUserProfile: async () => {
        if (opts.profileError) throw opts.profileError;
        return {
          githubUserId: 1,
          login: 'Alice',
          email: 'alice@acme.com',
          installationIds: [INST, 999],
        };
      },
      listActivity: async (_o, _owner, _login, since) => {
        activityCalls.push(since);
        return [];
      },
      resolveTeamMembers: async (_o, _owner, members) => members.map((m) => m.toLowerCase()),
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
    chatFor: async () =>
      opts.hasSlack === false
        ? null
        : ({
            findUserByEmail: async () => {
              if (opts.findUserError) throw opts.findUserError;
              return opts.slackUser === undefined ? 'U9' : opts.slackUser;
            },
          } as never),
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
  return {
    app: createApp(deps, { getClientIp: () => '192.0.2.1' }),
    queue,
    activityCalls,
    membershipCalls,
    members,
    setNow: (d) => {
      now = d;
    },
  };
}

async function seed(cfg: StandwiseConfig | null = config()): Promise<void> {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  await setInstallationConfig(
    db,
    INST,
    cfg ? { status: 'configured', config: cfg } : { status: 'unconfigured', reason: 'no_repo' },
  );
}

async function login(h: Harness): Promise<string> {
  const res = await h.app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ githubToken: 'gho_x' }),
  });
  return ((await res.json()) as { token: string }).token;
}

const daily = {
  org: 'acme',
  yesterday: [{ text: 'did a thing' }],
  today: [{ text: 'do another' }],
  blockers: [],
};

function post(h: Harness, token: string, body: unknown) {
  return h.app.request('/v1/dailies', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(h: Harness, token: string | null, path: string) {
  return h.app.request(path, token ? { headers: { authorization: `Bearer ${token}` } } : {});
}

useCleanDb();

describe('meta', () => {
  test('health and meta', async () => {
    const h = harness();
    expect(await (await h.app.request('/health')).json()).toEqual({ ok: true });
    expect(await (await h.app.request('/v1/meta')).json()).toEqual({
      githubClientId: 'cid',
      supportEmail: 'help@sw.test',
    });
  });
});

describe('sessions', () => {
  test('sessions creates member and links slack by email', async () => {
    await seed();
    const h = harness();
    const res = await h.app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubToken: 'gho_x' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; login: string; orgs: unknown[] };
    expect(body.token.startsWith('sw_')).toBe(true);
    expect(body.login).toBe('Alice');
    expect(body.orgs).toEqual([{ installationId: INST, login: 'acme' }]);
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U9');
  });

  test('config override wins over email', async () => {
    await seed(config('members:\n  alice:\n    slack: U1\n'));
    const h = harness();
    await login(h);
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U1');
  });

  test('sessions link slack with the last valid config while standwise.yml is invalid', async () => {
    await seed();
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    await login(harness());
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U9');
  });

  test('sessions without slack connection links nothing', async () => {
    await seed();
    const h = harness({ hasSlack: false });
    await login(h);
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });

  test('sessions rejects missing token', async () => {
    const h = harness();
    const res = await h.app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(422);
  });
});

describe('end session', () => {
  test('DELETE /v1/sessions/current revokes the token', async () => {
    const h = harness();
    await seed();
    const token = await login(h);
    const res = await h.app.request('/v1/sessions/current', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    expect((await get(h, token, '/v1/draft?org=acme')).status).toBe(401);
  });

  test('DELETE /v1/sessions/current requires a session', async () => {
    const h = harness();
    const res = await h.app.request('/v1/sessions/current', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('sessions resilience', () => {
  test('slack failure does not block login', async () => {
    await seed();
    const h = harness({ findUserError: new ChatDeliveryError('token_revoked', 'revoked') });
    const res = await h.app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubToken: 'gho_x' }),
    });
    expect(res.status).toBe(200);
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });

  test('invalid github token is 401', async () => {
    for (const status of [401, 403]) {
      const h = harness({ profileError: Object.assign(new Error('bad'), { status }) });
      const res = await h.app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubToken: 'gho_x' }),
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    }
  });
});

describe('org access', () => {
  test('removed member gets 404 and loses the installation', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    h.members.delete('alice');
    const res = await get(h, token, '/v1/draft?org=acme');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('org_not_found');
    const me = await resolveSession(db, token, 'cli');
    expect(await listMemberInstallations(db, me?.id ?? '')).toEqual([]);
  });

  test('removed member cannot submit', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    h.members.delete('alice');
    expect((await post(h, token, daily)).status).toBe(404);
  });

  test('positive membership is cached for ten minutes', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    await get(h, token, '/v1/draft?org=acme');
    await get(h, token, '/v1/draft?org=acme');
    expect(h.membershipCalls).toHaveLength(1);
    h.setNow(new Date('2026-10-28T15:11:00Z'));
    await get(h, token, '/v1/draft?org=acme');
    expect(h.membershipCalls).toHaveLength(2);
  });

  test('user account requires login match without github call', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'ALICE', accountType: 'User' });
    await setInstallationConfig(db, INST, { status: 'configured', config: config() });
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=alice');
    expect(res.status).toBe(200);
    expect(h.membershipCalls).toHaveLength(0);
  });

  test('other tenant is not reachable', async () => {
    await seed();
    await upsertInstallation(db, { id: 22, accountLogin: 'globex', accountType: 'Organization' });
    await setInstallationConfig(db, 22, { status: 'configured', config: config() });
    const h = harness();
    const token = await login(h);
    const draft = await get(h, token, '/v1/draft?org=globex');
    expect(draft.status).toBe(404);
    const submit = await post(h, token, { ...daily, org: 'globex' });
    expect(submit.status).toBe(404);
  });

  test('missing org is invalid request', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft');
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
  });
});

describe('today', () => {
  test('returns the standup date for the org without fetching activity', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    h.setNow(new Date('2026-10-31T15:00:00Z'));
    const res = await get(h, token, '/v1/today?org=acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ org: 'acme', date: '2026-11-02', teams: ['Alpha'] });
    expect(h.activityCalls).toEqual([]);
    expect((await get(h, null, '/v1/today?org=acme')).status).toBe(401);
    expect((await get(h, token, '/v1/today')).status).toBe(422);
  });
});

describe('draft', () => {
  test('draft requires auth', async () => {
    const h = harness();
    const res = await get(h, null, '/v1/draft?org=acme');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  test('draft unknown org', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=other');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('org_not_found');
  });

  test('draft not configured', async () => {
    await seed(null);
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=acme');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'org_not_configured',
    );
  });

  test('draft and submit use the last valid config while standwise.yml is invalid', async () => {
    await seed();
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    const h = harness();
    const token = await login(h);
    expect((await get(h, token, '/v1/draft?org=acme')).status).toBe(200);
    const res = await post(h, token, daily);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ date: '2026-10-28', teams: ['Alpha'], late: false });
  });

  test('draft is not configured when an invalid push follows a removed file', async () => {
    await seed();
    await setInstallationConfig(db, INST, { status: 'unconfigured', reason: 'no_file' });
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=acme');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'org_not_configured',
    );
  });

  test('draft is not configured when standwise.yml was never valid', async () => {
    await seed(null);
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=acme');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'org_not_configured',
    );
    const submit = await post(h, token, daily);
    expect(submit.status).toBe(409);
    expect(((await submit.json()) as { error: { code: string } }).error.code).toBe(
      'org_not_configured',
    );
  });

  test('draft window', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=acme');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      org: string;
      date: string;
      since: string;
      teams: string[];
      activity: unknown[];
      suggestions: unknown[];
    };
    expect(body.date).toBe('2026-10-28');
    expect(body.teams).toEqual(['Alpha']);
    expect(body.since).toBe('2026-10-27T03:00:00.000Z');
    expect(h.activityCalls[0]?.toISOString()).toBe('2026-10-27T03:00:00.000Z');
    expect(body.suggestions).toEqual([]);
  });

  test('draft not in team', async () => {
    await seed(outsider());
    const h = harness();
    const token = await login(h);
    const res = await get(h, token, '/v1/draft?org=acme');
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_in_team');
  });
});

describe('dailies', () => {
  test('records how the daily was confirmed from the confirmation header', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const send = (value?: string) =>
      h.app.request('/v1/dailies', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(value ? { 'x-standwise-confirmation': value } : {}),
        },
        body: JSON.stringify(daily),
      });
    const stored = async () => (await listDailies(db, INST, '2026-10-28'))[0]?.payload;
    expect((await send('agent')).status).toBe(200);
    expect(await stored()).toEqual({ ...daily, confirmation: 'agent' });
    expect((await send('human')).status).toBe(200);
    expect(await stored()).toEqual({ ...daily, confirmation: 'human' });
    expect((await send('robot')).status).toBe(200);
    expect(await stored()).toEqual(daily);
    expect((await send()).status).toBe(200);
    expect(await stored()).toEqual(daily);
  });

  test('rejects control and bidi characters', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const res = await post(h, token, { ...daily, today: [{ text: 'a\u202eb' }] });
    expect(res.status).toBe(422);
    expect(await listDailies(db, INST, '2026-10-28')).toEqual([]);
  });

  test('events emitted', async () => {
    await seed();
    const h = harness();
    await insertWebhookEndpoint(
      db,
      {
        installationId: INST,
        url: 'https://hooks.example.com/',
        events: ['daily.submitted', 'blocker.opened'],
        secret: 'whsec_x',
      },
      KEY,
    );
    const token = await login(h);
    const events = async () => {
      const out: { type: string; data: Record<string, unknown> }[] = [];
      for (const job of h.queue.enqueued.filter((j) => j.name === 'deliver-webhook')) {
        const row = await getWebhookDelivery(db, (job.data as { deliveryId: string }).deliveryId);
        out.push(row?.payload as { type: string; data: Record<string, unknown> });
      }
      h.queue.enqueued.length = 0;
      return out;
    };
    const withBlocker = { ...daily, blockers: [{ text: 'Waiting for the DB' }] };
    expect((await post(h, token, withBlocker)).status).toBe(200);
    const first = await events();
    expect(first.map((e) => e.type)).toEqual(['daily.submitted', 'blocker.opened']);
    expect(first[0]?.data.replaced).toBe(false);
    expect(first[1]?.data.text).toBe('Waiting for the DB');
    expect((await post(h, token, withBlocker)).status).toBe(200);
    const second = await events();
    expect(second.map((e) => e.type)).toEqual(['daily.submitted']);
    expect(second[0]?.data.replaced).toBe(true);
  });

  test('submit not in team', async () => {
    await seed(outsider());
    const h = harness();
    const token = await login(h);
    const res = await post(h, token, daily);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_in_team');
  });

  test('submit invalid daily', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const res = await post(h, token, { ...daily, today: [] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; issues: unknown[] } };
    expect(body.error.code).toBe('invalid_daily');
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  test('submit requires auth', async () => {
    const h = harness();
    expect((await post(h, 'sw_nope', daily)).status).toBe(401);
  });

  test('submit replaces same day', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const first = await post(h, token, daily);
    expect(first.status).toBe(200);
    await post(h, token, { ...daily, today: [{ text: 'changed' }] });
    const rows = await listDailies(db, INST, '2026-10-28');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.today[0]?.text).toBe('changed');
    expect(await first.json()).toEqual({ date: '2026-10-28', teams: ['Alpha'], late: false });
  });

  test('submit on saturday', async () => {
    await seed();
    const h = harness();
    h.setNow(new Date('2026-10-31T15:00:00Z'));
    const token = await login(h);
    const res = await post(h, token, daily);
    expect(((await res.json()) as { date: string }).date).toBe('2026-11-02');
  });

  test('submit after digest is late', async () => {
    await seed();
    const h = harness();
    const token = await login(h);
    const key = {
      installationId: INST,
      teamName: 'Alpha',
      date: '2026-10-28',
      kind: 'digest' as const,
    };
    const claim = await claimDelivery(db, key);
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await completeDelivery(db, key, claim.token, { channel: 'C1', id: '1.1' });
    const res = await post(h, token, daily);
    const body = (await res.json()) as { late: boolean };
    expect(body.late).toBe(true);
    expect(h.queue.enqueued).toHaveLength(1);
    expect(h.queue.enqueued[0]?.name).toBe('send-late-daily');
    expect(h.queue.enqueued[0]?.data).toMatchObject({
      installationId: INST,
      date: '2026-10-28',
    });
  });
});
