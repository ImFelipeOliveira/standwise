import { describe, expect, spyOn, test } from 'bun:test';
import { parseConfig, type Ref, type StandwiseConfig } from '@standwise/core';
import { getConnection, saveConnection, setIdentity, upsertMember } from '@standwise/db';
import { LinearAuthError } from '@standwise/linear';
import { db, useCleanDb } from '../../db/test/setup';
import { nullTracker, type ProjectTracker } from '../src';
import { fakeDeps, INST, seedOrg } from './use-cases/fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);

function trackerConfig(tracker = '    tracker: { provider: linear, team: ENG }', extra = '') {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [mgr]
    members: [alice, bob, "@acme/backend"]
    chat: { provider: slack, channel: "#alpha" }
${tracker}
${extra}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

async function connect() {
  await saveConnection(
    db,
    INST,
    'linear',
    'org-1',
    JSON.stringify({ accessToken: 'lin_at_1', refreshToken: null, expiresAt: null }),
    KEY,
    'Acme',
    'acme',
  );
}

async function link(login: string, linearId: string, githubUserId: number) {
  const member = await upsertMember(db, { githubUserId, login, email: `${login}@acme.com` });
  await setIdentity(db, INST, member.id, 'linear', linearId);
}

const user = (id: string, email: string | null = null) => ({ id, email });

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    identifier: 'ENG-1',
    url: 'https://linear.app/acme/issue/ENG-1/fix',
    title: 'Fix login',
    assignee: null,
    creator: null,
    inverseRelations: { nodes: [] },
    ...overrides,
  };
}

const card = (url = 'https://linear.app/acme/issue/ENG-1/fix'): Ref => ({ kind: 'card', url });

async function setup(cfg: StandwiseConfig = trackerConfig(), connected = true) {
  await seedOrg(cfg);
  if (connected) await connect();
  const fake = fakeDeps();
  const resolved: string[][] = [];
  fake.deps.github.resolveTeamMembers = async (_o, _owner, members) => {
    resolved.push(members);
    return members.flatMap((m) => (m === '@acme/backend' ? ['dave'] : [m.toLowerCase()]));
  };
  const team = cfg.teams[0] as StandwiseConfig['teams'][number];
  const build = (): Promise<ProjectTracker> => fake.deps.trackerFor(INST, 'acme', cfg, team);
  return { ...fake, cfg, build, resolved };
}

const quiet = () => spyOn(console, 'error').mockImplementation(() => {});

describe('trackerFor', () => {
  test('a team without a tracker gets the null tracker', async () => {
    const fake = await setup(trackerConfig(''));
    const tracker = await fake.build();
    expect(tracker).toBe(nullTracker);
    expect(tracker.connected).toBe(false);
    expect(fake.linear.calls.bearer).toEqual([]);
  });

  test('a jira tracker gets the null tracker', async () => {
    const fake = await setup(trackerConfig('    tracker: { provider: jira, team: ENG }'));
    expect(await fake.build()).toBe(nullTracker);
  });

  test('no linear connection gets the null tracker', async () => {
    const fake = await setup(trackerConfig(), false);
    expect(await fake.build()).toBe(nullTracker);
  });

  test('a valid connection gets a connected tracker', async () => {
    const fake = await setup();
    expect((await fake.build()).connected).toBe(true);
    expect(fake.linear.calls.bearer).toEqual([]);
  });

  test('a refresh failure that is not auth gives the null tracker without throwing', async () => {
    const fake = await setup(trackerConfig(), false);
    await saveConnection(
      db,
      INST,
      'linear',
      'org-1',
      JSON.stringify({
        accessToken: 'lin_at_1',
        refreshToken: 'lin_rt_1',
        expiresAt: '2026-10-28T15:01:00.000Z',
      }),
      KEY,
      'Acme',
      'acme',
    );
    fake.linear.state.refreshError = new Error('linear oauth http 503');
    const spy = quiet();
    let tracker: ProjectTracker;
    try {
      tracker = await fake.build();
      expect(JSON.stringify(spy.mock.calls)).toContain('linear tracker unavailable');
    } finally {
      spy.mockRestore();
    }
    expect(tracker).toBe(nullTracker);
    expect(tracker.connected).toBe(false);
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeNull();
  });

  test('the null tracker answers nothing', async () => {
    expect(nullTracker.connected).toBe(false);
    expect(await nullTracker.cardOwners(card())).toBeNull();
    expect(await nullTracker.listActivity('alice', new Date())).toEqual([]);
    expect(await nullTracker.listStaleInProgress('alice')).toEqual([]);
  });
});

describe('cardOwners', () => {
  test('maps blockers, assignee and creator to github logins', async () => {
    const fake = await setup();
    await link('Alice', 'lin-alice', 1);
    await link('Dave', 'lin-dave', 2);
    await link('Bob', 'lin-bob', 3);
    fake.linear.state.issues.set(
      'ENG-1',
      issue({
        assignee: user('lin-bob'),
        creator: user('lin-alice'),
        inverseRelations: {
          nodes: [
            { type: 'blocks', issue: { identifier: 'BE-9', assignee: user('lin-dave') } },
            { type: 'blocks', issue: { identifier: 'BE-10', assignee: user('lin-ghost') } },
            { type: 'blocks', issue: { identifier: 'BE-11', assignee: null } },
          ],
        },
      }),
    );
    const tracker = await fake.build();
    expect(await tracker.cardOwners(card())).toEqual({
      blockers: ['dave'],
      assignee: 'bob',
      creator: 'alice',
    });
    expect(fake.linear.calls.queries).toEqual([
      { name: 'Issue', variables: { identifier: 'ENG-1' } },
    ]);
  });

  test('a config override email wins and people outside the config are left out', async () => {
    const cfg = trackerConfig(undefined, 'members:\n  bob:\n    linear: bob@corp.com');
    const fake = await setup(cfg);
    await link('Zed', 'lin-zed', 9);
    fake.linear.state.issues.set(
      'ENG-1',
      issue({ assignee: user('lin-other', 'BOB@corp.com'), creator: user('lin-zed') }),
    );
    const tracker = await fake.build();
    expect(await tracker.cardOwners(card())).toEqual({
      blockers: [],
      assignee: 'bob',
      creator: null,
    });
  });

  test('a card from another workspace or a malformed url makes no api call', async () => {
    const fake = await setup();
    const tracker = await fake.build();
    expect(await tracker.cardOwners(card('https://linear.app/other/issue/ENG-1'))).toBeNull();
    expect(await tracker.cardOwners(card('https://example.com/ENG-1'))).toBeNull();
    expect(fake.linear.calls.bearer).toEqual([]);
  });

  test('the workspace check ignores case', async () => {
    const fake = await setup();
    fake.linear.state.issues.set('ENG-1', issue());
    const tracker = await fake.build();
    expect(await tracker.cardOwners(card('https://linear.app/ACME/issue/eng-1'))).toEqual({
      blockers: [],
      assignee: null,
      creator: null,
    });
  });

  test('a card that is not found returns null', async () => {
    const fake = await setup();
    const tracker = await fake.build();
    expect(await tracker.cardOwners(card())).toBeNull();
  });

  test('an auth error invalidates the connection and returns null', async () => {
    const fake = await setup();
    const tracker = await fake.build();
    fake.linear.state.graphqlStatus = 401;
    const spy = quiet();
    try {
      expect(await tracker.cardOwners(card())).toBeNull();
      expect(JSON.stringify(spy.mock.calls)).toContain('LinearAuthError');
    } finally {
      spy.mockRestore();
    }
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeInstanceOf(Date);
  });

  test('any other error is logged and returns null without invalidating', async () => {
    const fake = await setup();
    const tracker = await fake.build();
    fake.linear.state.graphqlStatus = 500;
    const spy = quiet();
    try {
      expect(await tracker.cardOwners(card())).toBeNull();
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain('Fix login');
    } finally {
      spy.mockRestore();
    }
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeNull();
  });

  test('a people resolution failure is logged on its own and returns null', async () => {
    const fake = await setup();
    fake.linear.state.issues.set('ENG-1', issue({ assignee: user('lin-x') }));
    fake.deps.github.resolveTeamMembers = async () => {
      throw Object.assign(new Error('teams down'), { status: 502 });
    };
    const tracker = await fake.build();
    const spy = quiet();
    try {
      expect(await tracker.cardOwners(card())).toBeNull();
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('tracker people resolution failed');
      expect(logged).not.toContain('linear card lookup failed');
    } finally {
      spy.mockRestore();
    }
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeNull();
  });

  test('config people are resolved once per tracker', async () => {
    const fake = await setup();
    fake.linear.state.issues.set('ENG-1', issue({ assignee: user('lin-x') }));
    const tracker = await fake.build();
    await tracker.cardOwners(card());
    fake.setNow(new Date('2026-10-28T16:00:00Z'));
    await tracker.cardOwners(card());
    expect(fake.resolved).toHaveLength(1);
  });
});

describe('listActivity and listStaleInProgress', () => {
  const since = new Date('2026-10-27T00:00:00Z');

  test('without a linear identity they return nothing and make no call', async () => {
    const fake = await setup();
    const tracker = await fake.build();
    expect(await tracker.listActivity('alice', since)).toEqual([]);
    expect(await tracker.listStaleInProgress('alice')).toEqual([]);
    expect(fake.linear.calls.bearer).toEqual([]);
  });

  test('they query the linked linear user within the team key', async () => {
    const fake = await setup();
    await link('Alice', 'lin-alice', 1);
    fake.linear.state.activity = [
      {
        id: 'a',
        identifier: 'ENG-1',
        url: 'https://linear.app/acme/issue/ENG-1',
        title: 'Done one',
        startedAt: '2026-10-26T10:00:00.000Z',
        completedAt: '2026-10-27T09:00:00.000Z',
      },
    ];
    fake.linear.state.stale = [
      {
        id: 'b',
        identifier: 'ENG-2',
        url: 'https://linear.app/acme/issue/ENG-2',
        title: 'Old',
        startedAt: '2026-10-01T10:00:00.000Z',
      },
    ];
    const tracker = await fake.build();
    expect(await tracker.listActivity('ALICE', since)).toEqual([
      {
        kind: 'card_done',
        title: 'Done one',
        url: 'https://linear.app/acme/issue/ENG-1',
        repo: 'ENG',
        at: new Date('2026-10-27T09:00:00.000Z'),
      },
    ]);
    expect(await tracker.listStaleInProgress('alice')).toEqual([
      {
        id: 'b',
        identifier: 'ENG-2',
        url: 'https://linear.app/acme/issue/ENG-2',
        title: 'Old',
        startedAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ]);
    expect(fake.linear.calls.queries).toEqual([
      {
        name: 'CardActivity',
        variables: { userId: 'lin-alice', teamKey: 'ENG', since: since.toISOString() },
      },
      { name: 'StaleInProgress', variables: { userId: 'lin-alice', teamKey: 'ENG' } },
    ]);
  });

  test('an auth error invalidates the connection and rethrows', async () => {
    const fake = await setup();
    await link('Alice', 'lin-alice', 1);
    const tracker = await fake.build();
    fake.linear.state.graphqlStatus = 401;
    await expect(tracker.listActivity('alice', since)).rejects.toBeInstanceOf(LinearAuthError);
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeInstanceOf(Date);
    await expect(tracker.listStaleInProgress('alice')).rejects.toBeInstanceOf(LinearAuthError);
  });

  test('a failed invalidation is logged and the original auth error is rethrown', async () => {
    const fake = await setup();
    await link('Alice', 'lin-alice', 1);
    const tracker = await fake.build();
    const real = fake.deps.db;
    fake.deps.db = new Proxy(real, {
      get(target, prop) {
        if (prop === 'update') {
          return () => {
            throw new Error('db down');
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    fake.linear.state.graphqlStatus = 401;
    const spy = quiet();
    try {
      await expect(tracker.listActivity('alice', since)).rejects.toBeInstanceOf(LinearAuthError);
      await expect(tracker.listStaleInProgress('alice')).rejects.toBeInstanceOf(LinearAuthError);
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('linear connection invalidation failed');
      expect(logged).toContain('db down');
    } finally {
      spy.mockRestore();
      fake.deps.db = real;
    }
  });

  test('other errors are rethrown without invalidating', async () => {
    const fake = await setup();
    await link('Alice', 'lin-alice', 1);
    const tracker = await fake.build();
    fake.linear.state.graphqlStatus = 500;
    await expect(tracker.listActivity('alice', since)).rejects.toThrow('linear http 500');
    await expect(tracker.listStaleInProgress('alice')).rejects.toThrow('linear http 500');
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeNull();
  });
});
