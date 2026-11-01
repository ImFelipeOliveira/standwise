import { describe, expect, spyOn, test } from 'bun:test';
import {
  getConnection,
  getIdentities,
  saveConnection,
  setIdentity,
  setMemberInstallations,
  upsertMember,
} from '@standcast/db';
import { LinearRateLimitError } from '@standcast/linear';
import { db, useCleanDb } from '../../db/test/setup';
import {
  configPeople,
  enqueueLinkTrackerIdentities,
  LINK_TRACKER_BATCH,
  LINK_TRACKER_IDENTITIES_JOB,
  LINK_TRACKER_IDENTITY_JOB,
  type LinkTrackerIdentitiesJob,
  type LinkTrackerIdentityJob,
  linkTrackerIdentities,
  linkTrackerIdentity,
  loginForLinearUser,
  startSession,
} from '../src';
import { config, fakeDeps, INST, seedMember, seedOrg } from './use-cases/fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);

async function connect(inst = INST) {
  await saveConnection(
    db,
    inst,
    'linear',
    'org-1',
    JSON.stringify({ accessToken: 'lin_at_1', refreshToken: null, expiresAt: null }),
    KEY,
    'Acme',
    'acme',
  );
}

const people: ReadonlySet<string> = new Set(['alice', 'bob']);

const overrides = (body: string) => `members:\n${body}`;

describe('linking at login', () => {
  const linkJobs = (queue: ReturnType<typeof fakeDeps>['queue']) =>
    queue.enqueued.filter((j) => j.name === LINK_TRACKER_IDENTITY_JOB).map((j) => j.data);

  test('a login with linear connected enqueues a job and never calls linear', async () => {
    await seedOrg();
    await connect();
    const { deps, linear, queue } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    await startSession(deps, { githubToken: 'gho_x' });
    const member = await seedMember();
    expect(linkJobs(queue)).toEqual([{ installationId: INST, memberId: member.id }]);
    expect(linear.calls.bearer).toEqual([]);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('a login without a linear connection enqueues nothing', async () => {
    await seedOrg();
    const { deps, queue } = fakeDeps();
    await startSession(deps, { githubToken: 'gho_x' });
    expect(linkJobs(queue)).toEqual([]);
  });

  test('the queued job links the person by the stored github email', async () => {
    await seedOrg();
    await connect();
    const { deps, linear, queue } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    await queue.work(
      LINK_TRACKER_IDENTITY_JOB,
      async (data: LinkTrackerIdentityJob) =>
        linkTrackerIdentity(deps, data.installationId, data.memberId),
      { policies: ['stately'] },
    );
    await startSession(deps, { githubToken: 'gho_x' });
    await queue.drain();
    expect((await getIdentities(db, INST, 'linear')).get('alice')).toBe('lin-alice');
  });

  test('the config override wins over the github email', async () => {
    await seedOrg(config('[alice, bob]', overrides('  alice:\n    linear: other@acme.com')));
    await connect();
    const member = await seedMember();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-wrong');
    linear.state.users.set('other@acme.com', 'lin-right');
    await linkTrackerIdentity(deps, INST, member.id);
    expect((await getIdentities(db, INST, 'linear')).get('alice')).toBe('lin-right');
    expect(linear.calls.userLookups).toEqual(['other@acme.com']);
  });

  test('no linear user removes a stale identity', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-old');
    const { deps } = fakeDeps();
    await linkTrackerIdentity(deps, INST, member.id);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('a linear failure is logged and does not throw', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 500;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await linkTrackerIdentity(deps, INST, member.id);
    } finally {
      spy.mockRestore();
    }
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('an auth failure invalidates the connection without throwing', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 401;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await linkTrackerIdentity(deps, INST, member.id);
    } finally {
      spy.mockRestore();
    }
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeTruthy();
  });

  test('a rate limit throws so the job is retried', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 429;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(linkTrackerIdentity(deps, INST, member.id)).rejects.toBeInstanceOf(
        LinearRateLimitError,
      );
    } finally {
      spy.mockRestore();
    }
  });

  test('does nothing without a connection or an operational config', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    await linkTrackerIdentity(deps, INST, member.id);
    expect(linear.calls.bearer).toEqual([]);
    await seedOrg(null);
    await connect();
    await linkTrackerIdentity(deps, INST, member.id);
    expect(linear.calls.bearer).toEqual([]);
  });

  test('a workspace change during the lookup writes nothing', async () => {
    await seedOrg();
    await connect();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    const original = deps.linear.fetch;
    if (!original) throw new Error('expected a fetch');
    deps.linear = {
      ...deps.linear,
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        await saveConnection(db, INST, 'linear', 'org-2', '{}', KEY, 'Other', 'other');
        return original(url, init);
      }) as typeof fetch,
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await linkTrackerIdentity(deps, INST, member.id);
    } finally {
      spy.mockRestore();
    }
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('without any email it removes a stale identity and never calls linear', async () => {
    await seedOrg();
    await connect();
    const member = await upsertMember(db, { githubUserId: 1, login: 'Alice', email: null });
    await setIdentity(db, INST, member.id, 'linear', 'lin-old');
    const { deps, linear } = fakeDeps();
    await linkTrackerIdentity(deps, INST, member.id);
    expect(linear.calls.userLookups).toEqual([]);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });
});

describe('linkTrackerIdentities', () => {
  async function seedTeam() {
    await seedOrg();
    await connect();
    const alice = await seedMember();
    const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: 'bob@acme.com' });
    const eve = await upsertMember(db, { githubUserId: 3, login: 'eve', email: 'eve@acme.com' });
    for (const m of [alice, bob, eve]) await setMemberInstallations(db, m.id, [INST]);
  }

  test('links every configured member and skips people outside the config', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    linear.state.users.set('bob@acme.com', 'lin-bob');
    linear.state.users.set('eve@acme.com', 'lin-eve');
    await linkTrackerIdentities(deps, INST);
    const ids = await getIdentities(db, INST, 'linear');
    expect(Object.fromEntries(ids)).toEqual({ alice: 'lin-alice', bob: 'lin-bob' });
  });

  test('links a person who is in the config only through a github team', async () => {
    await seedOrg(config('[alice, "@acme/backend"]'));
    await connect();
    const alice = await seedMember();
    const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: 'bob@acme.com' });
    for (const m of [alice, bob]) await setMemberInstallations(db, m.id, [INST]);
    const { deps, linear } = fakeDeps({ teams: { '@acme/backend': ['bob'] } });
    linear.state.users.set('alice@acme.com', 'lin-alice');
    linear.state.users.set('bob@acme.com', 'lin-bob');
    await linkTrackerIdentities(deps, INST);
    expect(Object.fromEntries(await getIdentities(db, INST, 'linear'))).toEqual({
      alice: 'lin-alice',
      bob: 'lin-bob',
    });
  });

  test('a rate limit stops the run and makes the job throw so it is retried', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 429;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(linkTrackerIdentities(deps, INST)).rejects.toBeInstanceOf(LinearRateLimitError);
    } finally {
      spy.mockRestore();
    }
    expect(linear.calls.bearer).toHaveLength(1);
    expect(linear.calls.userLookups).toEqual([]);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('stops and invalidates on an auth error without throwing', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.graphqlStatus = 401;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await linkTrackerIdentities(deps, INST);
    } finally {
      spy.mockRestore();
    }
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeTruthy();
    expect(linear.calls.bearer).toHaveLength(1);
  });

  function reconnectOnLookup(deps: ReturnType<typeof fakeDeps>['deps'], lookup: number) {
    const original = deps.linear.fetch;
    if (!original) throw new Error('expected a fetch');
    let lookups = 0;
    deps.linear = {
      ...deps.linear,
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(init?.body ?? '').includes('UserByEmail')) {
          lookups++;
          if (lookups === lookup) {
            await saveConnection(db, INST, 'linear', 'org-2', '{}', KEY, 'Other', 'other');
          }
        }
        return original(url, init);
      }) as typeof fetch,
    };
  }

  test('a workspace change mid-run stops writes from the old workspace', async () => {
    await seedTeam();
    const { deps, linear } = fakeDeps();
    linear.state.users.set('alice@acme.com', 'lin-alice');
    linear.state.users.set('bob@acme.com', 'lin-bob');
    reconnectOnLookup(deps, 1);
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await linkTrackerIdentities(deps, INST);
    } finally {
      spy.mockRestore();
    }
    expect(linear.calls.userLookups).toEqual(['alice@acme.com']);
    expect((await getIdentities(db, INST, 'linear')).size).toBe(0);
  });

  test('a relink of 450 members runs as three chained jobs and links everyone', async () => {
    await seedOrg(config('[alice, "@acme/big"]'));
    await connect();
    const logins = Array.from({ length: 450 }, (_, i) => `m${String(i).padStart(3, '0')}`);
    const { deps, linear, queue } = fakeDeps({ teams: { '@acme/big': logins } });
    for (const [i, login] of logins.entries()) {
      const m = await upsertMember(db, {
        githubUserId: 1000 + i,
        login,
        email: `${login}@acme.com`,
      });
      await setMemberInstallations(db, m.id, [INST]);
      linear.state.users.set(`${login}@acme.com`, `lin-${login}`);
    }
    const runs: LinkTrackerIdentitiesJob[] = [];
    await queue.work(
      LINK_TRACKER_IDENTITIES_JOB,
      async (data: LinkTrackerIdentitiesJob) => {
        runs.push(data);
        await linkTrackerIdentities(deps, data.installationId, data.afterLogin);
      },
      { policies: ['stately'] },
    );
    await enqueueLinkTrackerIdentities(deps, INST);
    await queue.drain();
    expect(LINK_TRACKER_BATCH).toBe(200);
    expect(runs).toEqual([
      { installationId: INST },
      { installationId: INST, afterLogin: 'm199' },
      { installationId: INST, afterLogin: 'm399' },
    ]);
    const ids = await getIdentities(db, INST, 'linear');
    expect(ids.size).toBe(450);
    expect(logins.every((l) => ids.get(l) === `lin-${l}`)).toBe(true);
  });

  test('does nothing when the installation has no config or no connection', async () => {
    await seedOrg();
    const { deps, linear } = fakeDeps();
    await linkTrackerIdentities(deps, INST);
    expect(linear.calls.bearer).toEqual([]);
  });
});

describe('loginForLinearUser', () => {
  test('resolves by config override, case-insensitive', async () => {
    await seedOrg();
    const cfg = config('[alice, bob]', overrides('  bob:\n    linear: Bob@Acme.com'));
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, cfg, people, { id: 'x', email: 'bob@acme.com' }),
    ).toBe('bob');
  });

  test('resolves by stored identity', async () => {
    await seedOrg();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-alice');
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, config(), people, { id: 'lin-alice', email: null }),
    ).toBe('alice');
  });

  test('returns null for an unknown user', async () => {
    await seedOrg();
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, config(), people, { id: 'nope', email: 'z@acme.com' }),
    ).toBeNull();
  });

  test('returns null for a login outside the config', async () => {
    await seedOrg();
    const member = await seedMember('zed', 9);
    await setMemberInstallations(db, member.id, [INST]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-zed');
    const cfg = config('[alice]', overrides('  zed:\n    linear: zed@acme.com'));
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, cfg, people, { id: 'lin-zed', email: 'zed@acme.com' }),
    ).toBeNull();
  });

  test('returns null when two overrides share an email', async () => {
    await seedOrg();
    const cfg = config(
      '[alice, bob]',
      overrides('  alice:\n    linear: same@acme.com\n  bob:\n    linear: SAME@acme.com'),
    );
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, cfg, people, { id: 'x', email: 'same@acme.com' }),
    ).toBeNull();
  });

  test('never uses an identity of another installation', async () => {
    await seedOrg();
    await seedOrg(config(), { id: 12, accountLogin: 'other' });
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST, 12]);
    await setIdentity(db, INST, member.id, 'linear', 'lin-alice');
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, 12, config(), people, { id: 'lin-alice', email: null }),
    ).toBeNull();
    expect(
      await loginForLinearUser(deps, INST, config(), people, { id: 'lin-alice', email: null }),
    ).toBe('alice');
  });

  test('resolves a person who is in the config only through a github team', async () => {
    await seedOrg(config('[alice, "@acme/backend"]'));
    const { deps } = fakeDeps({ teams: { '@acme/backend': ['bob'] } });
    const cfg = config('[alice, "@acme/backend"]', overrides('  bob:\n    linear: bob@acme.com'));
    const resolved = await configPeople(deps, INST, 'acme', cfg);
    expect([...resolved].sort()).toEqual(['alice', 'bob']);
    expect(
      await loginForLinearUser(deps, INST, cfg, resolved, { id: 'x', email: 'bob@acme.com' }),
    ).toBe('bob');
  });

  test('returns null when two members hold the same linear id', async () => {
    await seedOrg();
    const alice = await seedMember();
    const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: null });
    for (const m of [alice, bob]) {
      await setMemberInstallations(db, m.id, [INST]);
      await setIdentity(db, INST, m.id, 'linear', 'lin-dup');
    }
    const { deps } = fakeDeps();
    expect(
      await loginForLinearUser(deps, INST, config(), people, { id: 'lin-dup', email: null }),
    ).toBeNull();
  });

  test('job name is stable', () => {
    expect(LINK_TRACKER_IDENTITIES_JOB).toBe('link-tracker-identities');
    expect(LINK_TRACKER_IDENTITY_JOB).toBe('link-tracker-identity');
  });
});
