import { describe, expect, spyOn, test } from 'bun:test';
import {
  buildBlockerRouted,
  type Item,
  parseConfig,
  type ResolvedTeam,
  type StandwiseConfig,
} from '@standwise/core';
import {
  claimDelivery,
  getConnection,
  getDelivery,
  getIdentities,
  saveConnection,
  setIdentity,
  setMemberInstallations,
  upsertDaily,
  upsertMember,
} from '@standwise/db';
import type { PullRequestDetail } from '@standwise/github';
import { ChatDeliveryError } from '@standwise/slack';
import { deliveries } from '../../../db/src/schema';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  blockerRouteId,
  createMembershipCheck,
  type RouteBlockerJob,
  resolveRouteTarget,
  routeBlocker,
  submitDaily,
} from '../../src';
import { daily, fakeChat, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const DATE = '2026-10-28';

function routeConfig(extra = '', managers = '[mgr]'): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: ${managers}
    members: [alice, bob, carla]
    chat: { provider: slack, channel: "#alpha" }
    tracker: { provider: linear, team: ENG }
${extra}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

const identities = `members:
  carla: { slack: U0CARLA }
  dave: { slack: U0DAVE }
  erin: { slack: U0ERIN }
  mgr: { slack: U0MGR }
  bob: { slack: U0BOB }
  alice: { slack: U0ALICE }`;

function pull(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ref: { owner: 'acme', repo: 'api', number: 7 },
    url: 'https://github.com/acme/api/pull/7',
    title: 'Add cache',
    author: 'bob',
    state: 'open',
    draft: false,
    headSha: 'abc',
    baseRef: 'main',
    requestedReviewers: [],
    requestedTeams: [],
    ...overrides,
  };
}

const prBlocker = (url = 'https://github.com/acme/api/pull/7'): Item => ({
  text: 'Waiting for review on the cache PR',
  ref: { kind: 'pull_request', url, title: 'Add cache' },
});

const KEY = new Uint8Array(32).fill(7);

const cardBlocker = (url = 'https://linear.app/acme/issue/ENG-1/login'): Item => ({
  text: 'Card blocked',
  ref: { kind: 'card', url, title: 'Fix login' },
});

const lin = (id: string) => ({ id, email: null });

async function connectLinear() {
  if (await getConnection(db, INST, 'linear', KEY)) return;
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

let nextUserId = 100;

async function linkCard(
  fake: { linear: { state: { issues: Map<string, unknown> } } },
  people: { login: string; id: string }[],
  card: {
    assignee?: { id: string; email: null };
    creator?: { id: string; email: null };
    blockedBy?: { id: string; email: null }[];
  } = {},
) {
  await connectLinear();
  for (const person of people) {
    const member = await upsertMember(db, {
      githubUserId: nextUserId++,
      login: person.login,
      email: null,
    });
    await setIdentity(db, INST, member.id, 'linear', person.id);
  }
  fake.linear.state.issues.set('ENG-1', {
    id: 'i1',
    identifier: 'ENG-1',
    url: 'https://linear.app/acme/issue/ENG-1/login',
    title: 'Fix login',
    assignee: card.assignee ?? null,
    creator: card.creator ?? null,
    inverseRelations: {
      nodes: (card.blockedBy ?? []).map((assignee, i) => ({
        type: 'blocks',
        issue: { identifier: `BE-${9 + i}`, assignee },
      })),
    },
  });
}

const team = (cfg: StandwiseConfig): ResolvedTeam => ({
  ...(cfg.teams[0] as StandwiseConfig['teams'][number]),
  memberLogins: ['bob', 'carla'],
});

async function setup(
  opts: Parameters<typeof fakeDeps>[0] = {},
  extra = identities,
  managers = '[mgr]',
) {
  const cfg = routeConfig(extra, managers);
  await seedOrg(cfg);
  const fake = fakeDeps(opts);
  const chat = fakeChat();
  fake.deps.chatFor = async () => chat.chat;
  fake.deps.github.resolveTeamMembers = async (_o, _owner, members) => ({
    logins: members.flatMap((m) => (m === '@acme/backend' ? ['dave', 'bob'] : [m.toLowerCase()])),
    missingTeams: [],
    truncatedTeams: [],
  });
  return { ...fake, ...chat, cfg };
}

function target(
  fake: Awaited<ReturnType<typeof setup>>,
  blocker: Item,
  author = 'bob',
): ReturnType<typeof resolveRouteTarget> {
  return resolveRouteTarget(fake.deps, {
    installationId: INST,
    owner: 'acme',
    config: fake.cfg,
    author,
    firstTeam: team(fake.cfg),
    blocker,
  });
}

async function seedDaily(blockers: Item[], login = 'bob') {
  const member = await upsertMember(db, { githubUserId: 42, login, email: `${login}@acme.com` });
  const { id } = await upsertDaily(db, {
    installationId: INST,
    memberId: member.id,
    date: DATE,
    payload: {
      org: 'acme',
      yesterday: [{ text: 'secret yesterday work' }],
      today: [{ text: 'secret today plan' }],
      blockers,
    },
    submittedAt: new Date('2026-10-28T12:00:00Z'),
  });
  return id;
}

describe('resolveRouteTarget', () => {
  test('a PR with a requested reviewer routes to the reviewer', async () => {
    const fake = await setup({ pulls: { 'acme/api#7': pull({ requestedReviewers: ['Carla'] }) } });
    expect(await target(fake, prBlocker())).toEqual({ reason: 'pr_reviewers', logins: ['carla'] });
    expect(fake.calls.codeowners).toEqual([]);
  });

  test('requested teams are expanded within the installation owner', async () => {
    const fake = await setup({ pulls: { 'acme/api#7': pull({ requestedTeams: ['backend'] }) } });
    expect(await target(fake, prBlocker())).toEqual({ reason: 'pr_reviewers', logins: ['dave'] });
  });

  test('without reviewers it routes to the CODEOWNERS of the changed files', async () => {
    const seen: string[][] = [];
    const fake = await setup({
      pulls: { 'acme/api#7': pull({ baseRef: 'release' }) },
      files: { 'acme/api#7': ['src/a.ts', 'README.md'] },
      codeowners: {
        'acme/api': 'src/** @acme/backend @Erin @other/team\n*.md @frank\nlib/** @gina',
      },
    });
    const resolve = fake.deps.github.resolveTeamMembers;
    fake.deps.github.resolveTeamMembers = async (o, owner, members) => {
      seen.push(members);
      return resolve(o, owner, members);
    };
    expect(await target(fake, prBlocker())).toEqual({
      reason: 'codeowners',
      logins: ['dave', 'erin', 'frank'],
    });
    expect(fake.calls.codeowners).toEqual([{ repo: 'acme/api', ref: 'release' }]);
    expect(seen.flat()).not.toContain('@other/team');
  });

  test('the PR author and the daily author are never included', async () => {
    const fake = await setup({
      pulls: {
        'acme/api#7': pull({ author: 'Zed', requestedReviewers: ['zed', 'BOB', 'carla'] }),
      },
    });
    expect(await target(fake, prBlocker())).toEqual({ reason: 'pr_reviewers', logins: ['carla'] });
  });

  test('a foreign owner falls back to managers without calling GitHub', async () => {
    const fake = await setup();
    const result = await target(fake, prBlocker('https://github.com/other/api/pull/7'));
    expect(result).toEqual({ reason: 'manager', logins: ['mgr'] });
    expect(fake.calls.getPullRequest).toEqual([]);
  });

  test('a malformed PR url falls back to managers without calling GitHub', async () => {
    const fake = await setup();
    const result = await target(fake, prBlocker('https://github.com/acme/api/issues/7'));
    expect(result).toEqual({ reason: 'manager', logins: ['mgr'] });
    expect(fake.calls.getPullRequest).toEqual([]);
  });

  test('a missing PR falls back to managers', async () => {
    const fake = await setup();
    expect(await target(fake, prBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
    expect(fake.calls.getPullRequest).toEqual(['acme/api#7']);
  });

  test('a PR without reviewers or owners falls back to managers', async () => {
    const fake = await setup({ pulls: { 'acme/api#7': pull() } });
    expect(await target(fake, prBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
  });

  test('a card blocked by another card routes to the blocking card assignee', async () => {
    const fake = await setup();
    await linkCard(
      fake,
      [
        { login: 'Carla', id: 'lin-carla' },
        { login: 'Alice', id: 'lin-alice' },
      ],
      { assignee: lin('lin-alice'), blockedBy: [lin('lin-carla')] },
    );
    expect(await target(fake, cardBlocker())).toEqual({
      reason: 'card_blocker',
      logins: ['carla'],
    });
    expect(fake.linear.calls.queries).toEqual([
      { name: 'Issue', variables: { identifier: 'ENG-1' } },
    ]);
  });

  test('without a blocker relation it routes to the assignee, then the creator', async () => {
    const fake = await setup();
    await linkCard(
      fake,
      [
        { login: 'Alice', id: 'lin-alice' },
        { login: 'Carla', id: 'lin-carla' },
      ],
      { assignee: lin('lin-alice'), creator: lin('lin-carla') },
    );
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'card_owner', logins: ['alice'] });
    await linkCard(fake, [], { creator: lin('lin-carla') });
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'card_owner', logins: ['carla'] });
  });

  test('a blocker assignee who is the author falls through to the next step', async () => {
    const fake = await setup();
    await linkCard(
      fake,
      [
        { login: 'Bob', id: 'lin-bob' },
        { login: 'Carla', id: 'lin-carla' },
      ],
      { blockedBy: [lin('lin-bob')], assignee: lin('lin-bob'), creator: lin('lin-carla') },
    );
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'card_owner', logins: ['carla'] });
  });

  test('a blocker assignee not linked to anyone falls through', async () => {
    const fake = await setup();
    await linkCard(fake, [{ login: 'Alice', id: 'lin-alice' }], {
      blockedBy: [lin('lin-ghost')],
      assignee: lin('lin-alice'),
    });
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'card_owner', logins: ['alice'] });
    await linkCard(fake, [], { blockedBy: [lin('lin-ghost')] });
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
  });

  test('a card from another workspace or a malformed url routes to managers without a fetch', async () => {
    const fake = await setup();
    await linkCard(fake, [{ login: 'Carla', id: 'lin-carla' }], { assignee: lin('lin-carla') });
    for (const url of ['https://linear.app/other/issue/ENG-1', 'https://linear.app/acme/ENG-1']) {
      expect(await target(fake, cardBlocker(url))).toEqual({ reason: 'manager', logins: ['mgr'] });
    }
    expect(fake.linear.calls.bearer).toEqual([]);
  });

  test('a card that is not found routes to managers', async () => {
    const fake = await setup();
    await connectLinear();
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
    expect(fake.linear.calls.queries.map((q) => q.name)).toEqual(['Issue']);
  });

  test('a linear auth error invalidates the connection and routes to managers', async () => {
    const fake = await setup();
    await linkCard(fake, [{ login: 'Carla', id: 'lin-carla' }], { assignee: lin('lin-carla') });
    fake.linear.state.graphqlStatus = 401;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await target(fake, cardBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
      expect(JSON.stringify(spy.mock.calls)).not.toContain('Card blocked');
    } finally {
      spy.mockRestore();
    }
    expect((await getConnection(db, INST, 'linear', KEY))?.invalidatedAt).toBeInstanceOf(Date);
  });

  test('without a linear connection the null tracker routes to managers', async () => {
    const fake = await setup();
    expect(await target(fake, cardBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
    expect(fake.linear.calls.bearer).toEqual([]);
  });

  test('a tracker failure routes to managers', async () => {
    const fake = await setup();
    fake.deps.trackerFor = async () => {
      throw new Error('refresh down');
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await target(fake, cardBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
    } finally {
      spy.mockRestore();
    }
  });

  test('the card step passes the installation owner, the config and the first team', async () => {
    const fake = await setup();
    const seen: unknown[] = [];
    fake.deps.trackerFor = async (...args) => {
      seen.push(args);
      return {
        connected: true,
        cardOwners: async () => ({
          blockers: ['Erin', 'bob', 'erin', 'a1', 'a2', 'a3', 'a4', 'a5'],
          assignee: null,
          creator: null,
        }),
        listActivity: async () => [],
        listStaleInProgress: async () => ({ cards: [], truncated: false }),
      };
    };
    expect(await target(fake, cardBlocker())).toEqual({
      reason: 'card_blocker',
      logins: ['erin', 'a1', 'a2', 'a3', 'a4'],
    });
    expect(seen).toEqual([[INST, 'acme', fake.cfg, team(fake.cfg)]]);
  });

  test('a GitHub failure on the PR falls back to managers without rethrowing', async () => {
    const fake = await setup();
    fake.deps.github.getPullRequest = async () => {
      throw Object.assign(new Error('server error'), { status: 502 });
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await target(fake, prBlocker())).toEqual({ reason: 'manager', logins: ['mgr'] });
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('502');
      expect(logged).not.toContain('Waiting for review');
    } finally {
      spy.mockRestore();
    }
  });

  test('a CODEOWNERS or team lookup failure falls back to managers', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const owners = await setup({ pulls: { 'acme/api#7': pull() } });
      owners.deps.github.fetchCodeowners = async () => {
        throw new Error('codeowners down');
      };
      expect((await target(owners, prBlocker())).reason).toBe('manager');
      const teams = await setup({ pulls: { 'acme/api#7': pull({ requestedTeams: ['backend'] }) } });
      teams.deps.github.resolveTeamMembers = async () => {
        throw new Error('teams down');
      };
      expect((await target(teams, prBlocker())).reason).toBe('manager');
    } finally {
      spy.mockRestore();
    }
  });

  test('targets are capped at 5', async () => {
    const reviewers = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
    const fake = await setup({ pulls: { 'acme/api#7': pull({ requestedReviewers: reviewers }) } });
    const result = await target(fake, prBlocker());
    expect(result.logins).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });
});

describe('routeBlocker', () => {
  test('a card blocker DMs the blocking card assignee with the card reason', async () => {
    const fake = await setup();
    await linkCard(fake, [{ login: 'Carla', id: 'lin-carla' }], {
      blockedBy: [lin('lin-carla')],
    });
    const dailyId = await seedDaily([cardBlocker()]);
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 });
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0CARLA']);
    const text = fake.directs[0]?.msg.fallbackText ?? '';
    expect(text).toContain('Card blocked');
    expect(text).toContain('https://linear.app/acme/issue/ENG-1/login');
    expect(text).toContain('you are responsible for the blocking card');
    expect(text).not.toContain('secret');
  });

  test('sends one DM per target and never twice', async () => {
    const fake = await setup({ pulls: { 'acme/api#7': pull({ requestedReviewers: ['carla'] }) } });
    const dailyId = await seedDaily([prBlocker()]);
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 });
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 });
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0CARLA']);
    const text = fake.directs[0]?.msg.fallbackText ?? '';
    expect(text).toContain('Waiting for review on the cache PR');
    expect(text).toContain('https://github.com/acme/api/pull/7');
    expect(text).not.toContain('secret');
    const key = {
      installationId: INST,
      teamName: '',
      date: DATE,
      kind: 'blocker_route' as const,
      subject: `${dailyId}:${blockerRouteId(prBlocker())}:carla`,
    };
    expect((await getDelivery(db, key))?.status).toBe('sent');
  });

  test('falls back to managers when no target has a chat id', async () => {
    const fake = await setup(
      { pulls: { 'acme/api#7': pull({ requestedReviewers: ['nobody'] }) } },
      'members:\n  mgr: { slack: U0MGR }',
    );
    const dailyId = await seedDaily([prBlocker()]);
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 });
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0MGR']);
  });

  test('a target without a chat id fails as no_chat_identity', async () => {
    const fake = await setup({}, '');
    const blocker: Item = { text: 'Need prod access' };
    const dailyId = await seedDaily([blocker]);
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 });
    expect(fake.directs).toEqual([]);
    const failed = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: DATE,
      kind: 'blocker_route',
      subject: `${dailyId}:${blockerRouteId(blocker)}:mgr`,
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toStartWith('no_chat_identity');
  });

  test('a resubmit that shifts indexes still routes each blocker exactly once', async () => {
    const fake = await setup({}, identities);
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const isMember = createMembershipCheck(fake.deps);
    const a = { text: 'Need prod access' };
    const b = { text: 'Flaky CI' };
    await submitDaily(fake.deps, isMember, member, { ...daily, blockers: [a] });
    await submitDaily(fake.deps, isMember, member, { ...daily, blockers: [b, a] });
    const jobs = fake.queue.enqueued
      .filter((j) => j.name === 'route-blocker')
      .map((j) => j.data as RouteBlockerJob);
    expect(jobs.map((j) => j.blockerIndex)).toEqual([0, 0]);
    for (const job of jobs) await routeBlocker(fake.deps, job);
    for (const job of jobs) await routeBlocker(fake.deps, job);
    const texts = fake.directs.map((d) => d.msg.fallbackText);
    expect(texts).toHaveLength(2);
    expect(texts.filter((t) => t.includes('Need prod access'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('Flaky CI'))).toHaveLength(1);
  });

  test('rewording a blocker with the same ref is not routed again', async () => {
    const fake = await setup({ pulls: { 'acme/api#7': pull({ requestedReviewers: ['carla'] }) } });
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const isMember = createMembershipCheck(fake.deps);
    const routes = () =>
      fake.queue.enqueued
        .filter((j) => j.name === 'route-blocker')
        .map((j) => j.data as RouteBlockerJob);
    await submitDaily(fake.deps, isMember, member, { ...daily, blockers: [prBlocker()] });
    const [job] = routes();
    await routeBlocker(fake.deps, job as RouteBlockerJob);
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0CARLA']);
    const reworded: Item = {
      text: 'Still blocked: nobody reviewed the cache change',
      ref: { kind: 'pull_request', url: 'https://GitHub.com/acme/api/pull/7/#top', title: 'x' },
    };
    await submitDaily(fake.deps, isMember, member, { ...daily, blockers: [reworded] });
    expect(routes()).toHaveLength(1);
    expect(blockerRouteId(reworded)).toBe(blockerRouteId(prBlocker()));
    await routeBlocker(fake.deps, job as RouteBlockerJob);
    expect(fake.directs).toHaveLength(1);
  });

  test('a resubmit whose blocker url differs only in case is not routed again', async () => {
    const fake = await setup({ pulls: { 'acme/api#7': pull({ requestedReviewers: ['carla'] }) } });
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const isMember = createMembershipCheck(fake.deps);
    await submitDaily(fake.deps, isMember, member, { ...daily, blockers: [prBlocker()] });
    await submitDaily(fake.deps, isMember, member, {
      ...daily,
      blockers: [prBlocker('https://github.com/Acme/API/pull/7')],
    });
    expect(fake.queue.enqueued.filter((j) => j.name === 'route-blocker')).toHaveLength(1);
  });

  test('two blockers with different refs are routed separately', async () => {
    const fake = await setup({
      pulls: {
        'acme/api#7': pull({ requestedReviewers: ['carla'] }),
        'acme/api#8': pull({ requestedReviewers: ['carla'] }),
      },
    });
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const isMember = createMembershipCheck(fake.deps);
    const same = 'Waiting for review on the cache PR';
    await submitDaily(fake.deps, isMember, member, {
      ...daily,
      blockers: [
        prBlocker(),
        { text: same, ref: { kind: 'pull_request', url: 'https://github.com/acme/api/pull/8' } },
      ],
    });
    const jobs = fake.queue.enqueued
      .filter((j) => j.name === 'route-blocker')
      .map((j) => j.data as RouteBlockerJob);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) await routeBlocker(fake.deps, job);
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0CARLA', 'U0CARLA']);
  });

  test('at most 10 distinct blockers per daily are routed', async () => {
    const fake = await setup();
    const blockers: Item[] = Array.from({ length: 11 }, (_, i) => ({ text: `Blocker ${i}` }));
    const dailyId = await seedDaily(blockers);
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < blockers.length; i++) {
      await routeBlocker(fake.deps, {
        installationId: INST,
        dailyId,
        blockerIndex: i,
        blockerId: blockerRouteId(blockers[i] as Item),
      });
    }
    await routeBlocker(fake.deps, {
      installationId: INST,
      dailyId,
      blockerIndex: 3,
      blockerId: blockerRouteId(blockers[3] as Item),
    });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(fake.directs).toHaveLength(10);
    expect(fake.directs.some((d) => d.msg.fallbackText.includes('Blocker 10'))).toBe(false);
    expect(logged).toContain('blocker route cap reached');
    expect(logged).not.toContain('Blocker 10');
  });

  test('concurrent route jobs for one daily still route at most 10 blockers', async () => {
    const fake = await setup();
    const blockers: Item[] = Array.from({ length: 12 }, (_, i) => ({ text: `Parallel ${i}` }));
    const dailyId = await seedDaily(blockers);
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all(
      blockers.map((blocker, i) =>
        routeBlocker(fake.deps, {
          installationId: INST,
          dailyId,
          blockerIndex: i,
          blockerId: blockerRouteId(blocker),
        }),
      ),
    );
    spy.mockRestore();
    expect(fake.directs).toHaveLength(10);
    const rows = (await db.select().from(deliveries)).filter((r) => r.kind === 'blocker_route');
    expect(new Set(rows.map((r) => r.subject.split(':')[1])).size).toBe(10);
  });

  test('a job whose blocker was removed does nothing', async () => {
    const fake = await setup();
    const dailyId = await seedDaily([{ text: 'Other' }]);
    await routeBlocker(fake.deps, {
      installationId: INST,
      dailyId,
      blockerIndex: 0,
      blockerId: blockerRouteId({ text: 'Gone' }),
    });
    expect(fake.directs).toEqual([]);
  });

  test('a claim in progress makes the job retry', async () => {
    const fake = await setup();
    const blocker: Item = { text: 'Need prod access' };
    const dailyId = await seedDaily([blocker]);
    await claimDelivery(db, {
      installationId: INST,
      teamName: '',
      date: DATE,
      kind: 'blocker_route',
      subject: `${dailyId}:${blockerRouteId(blocker)}:mgr`,
    });
    await expect(
      routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 }),
    ).rejects.toThrow('blocker_route_in_progress');
    expect(fake.directs).toEqual([]);
  });

  test('no target at all records a failed delivery', async () => {
    const fake = await setup({}, identities, '[bob]');
    const blocker: Item = { text: 'Need prod access' };
    const dailyId = await seedDaily([blocker]);
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 });
    expect(fake.directs).toEqual([]);
    const failed = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: DATE,
      kind: 'blocker_route',
      subject: `${dailyId}:${blockerRouteId(blocker)}:-`,
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('no_route_target');
  });

  test('a partial failure resends only the target that failed', async () => {
    const fake = await setup({
      pulls: { 'acme/api#7': pull({ requestedReviewers: ['carla', 'dave'] }) },
    });
    const dailyId = await seedDaily([prBlocker()]);
    fake.hooks.afterSend = async () => {
      fake.failWith(new Error('slack down'));
    };
    const job = { installationId: INST, dailyId, blockerIndex: 0 };
    await expect(routeBlocker(fake.deps, job)).rejects.toThrow('slack down');
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0CARLA']);
    fake.hooks.afterSend = undefined;
    fake.failWith(null);
    await routeBlocker(fake.deps, job);
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0CARLA', 'U0DAVE']);
  });

  test('a failed send still reaches the remaining targets and the job retries', async () => {
    const fake = await setup({
      pulls: { 'acme/api#7': pull({ requestedReviewers: ['carla', 'dave', 'erin'] }) },
    });
    const dailyId = await seedDaily([prBlocker()]);
    const send = fake.chat.sendDirect;
    let calls = 0;
    fake.chat.sendDirect = async (userId, msg) => {
      calls++;
      if (calls === 1) throw new Error('slack down');
      return send(userId, msg);
    };
    const job = { installationId: INST, dailyId, blockerIndex: 0 };
    await expect(routeBlocker(fake.deps, job)).rejects.toThrow('slack down');
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0DAVE', 'U0ERIN']);
    await routeBlocker(fake.deps, job);
    expect(fake.directs.map((d) => d.userId)).toEqual(['U0DAVE', 'U0ERIN', 'U0CARLA']);
  });

  test('a user_not_found failure forgets only the stored slack identity of that target', async () => {
    const extra = 'members:\n  mgr: { slack: U0MGR }';
    const fake = await setup(
      { pulls: { 'acme/api#7': pull({ requestedReviewers: ['carla', 'dave'] }) } },
      extra,
    );
    for (const [login, id] of [
      ['carla', 'U1CARLA'],
      ['dave', 'U1DAVE'],
    ] as const) {
      const m = await upsertMember(db, { githubUserId: nextUserId++, login, email: null });
      await setIdentity(db, INST, m.id, 'slack', id);
    }
    const dailyId = await seedDaily([prBlocker()]);
    const send = fake.chat.sendDirect;
    fake.chat.sendDirect = async (userId, msg) => {
      if (userId === 'U1CARLA') throw new ChatDeliveryError('user_not_found', 'gone');
      return send(userId, msg);
    };
    const job = { installationId: INST, dailyId, blockerIndex: 0 };
    await expect(routeBlocker(fake.deps, job)).rejects.toThrow();
    expect(fake.directs.map((d) => d.userId)).toEqual(['U1DAVE']);
    const failed = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: DATE,
      kind: 'blocker_route',
      subject: `${dailyId}:${blockerRouteId(prBlocker())}:carla`,
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toStartWith('user_not_found');
    expect(Object.fromEntries(await getIdentities(db, INST, 'slack'))).toEqual({
      dave: 'U1DAVE',
    });
  });

  test('a missing daily or index does nothing', async () => {
    const fake = await setup();
    const dailyId = await seedDaily([{ text: 'Need prod access' }]);
    await routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 3 });
    await routeBlocker(fake.deps, {
      installationId: INST,
      dailyId: '00000000-0000-4000-8000-000000000009',
      blockerIndex: 0,
    });
    expect(fake.directs).toEqual([]);
  });

  test('a send failure marks the delivery failed and rethrows', async () => {
    const fake = await setup();
    const blocker: Item = { text: 'Need prod access' };
    const dailyId = await seedDaily([blocker]);
    fake.failWith(new Error('slack down'));
    await expect(
      routeBlocker(fake.deps, { installationId: INST, dailyId, blockerIndex: 0 }),
    ).rejects.toThrow('slack down');
    const failed = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: DATE,
      kind: 'blocker_route',
      subject: `${dailyId}:${blockerRouteId(blocker)}:mgr`,
    });
    expect(failed?.status).toBe('failed');
  });
});

describe('buildBlockerRouted', () => {
  test('a blocker text containing {name} stays literal', () => {
    const msg = buildBlockerRouted({
      lang: 'en',
      author: { login: 'bob', chatUserId: 'U0BOB' },
      blocker: { text: 'Template {name} breaks' },
      reason: 'manager',
      date: DATE,
    });
    expect(msg.fallbackText).toContain('Template {name} breaks');
    expect(msg.fallbackText.match(/@U0BOB/g)).toHaveLength(1);
  });

  const blocker = prBlocker();
  test.each(['en', 'pt-BR'] as const)(
    '%s contains the blocker, the author and the link',
    (lang) => {
      const msg = buildBlockerRouted({
        lang,
        author: { login: 'bob', chatUserId: 'U0BOB' },
        blocker,
        reason: 'pr_reviewers',
        date: DATE,
      });
      expect(msg.fallbackText).toContain('Waiting for review on the cache PR');
      expect(msg.fallbackText).toContain('https://github.com/acme/api/pull/7');
      expect(msg.fallbackText).toContain('@U0BOB');
      expect(msg.fallbackText).toContain(lang === 'pt-BR' ? '28/10/2026' : DATE);
    },
  );

  const reasons = {
    en: {
      pr_reviewers: 'you are a requested reviewer on the PR',
      codeowners: 'you own code changed in the PR',
      card_blocker: 'you are responsible for the blocking card',
      card_owner: 'you are responsible for or created the blocked card',
      manager: 'you manage the team',
    },
    'pt-BR': {
      pr_reviewers: 'você é revisor solicitado no PR',
      codeowners: 'você é dono de código alterado no PR',
      card_blocker: 'você é responsável pelo card que bloqueia',
      card_owner: 'você é responsável pelo card bloqueado ou o criou',
      manager: 'você é gestor do time',
    },
  } as const;
  for (const lang of ['en', 'pt-BR'] as const) {
    for (const reason of [
      'pr_reviewers',
      'codeowners',
      'card_blocker',
      'card_owner',
      'manager',
    ] as const) {
      test(`${lang} explains why the person got a ${reason} DM`, () => {
        const msg = buildBlockerRouted({
          lang,
          author: { login: 'bob' },
          blocker: { text: 'Need prod access' },
          reason,
          date: DATE,
        });
        expect(msg.fallbackText).toContain(reasons[lang][reason]);
        const others = Object.entries(reasons[lang]).filter(([key]) => key !== reason);
        for (const [, text] of others) expect(msg.fallbackText).not.toContain(text);
      });
    }
  }
});
