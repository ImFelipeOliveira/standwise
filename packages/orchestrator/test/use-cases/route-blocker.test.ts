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
  getDelivery,
  setMemberInstallations,
  upsertDaily,
  upsertMember,
} from '@standwise/db';
import type { PullRequestDetail } from '@standwise/github';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  blockerHash,
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
  fake.deps.github.resolveTeamMembers = async (_o, _owner, members) =>
    members.flatMap((m) => (m === '@acme/backend' ? ['dave', 'bob'] : [m.toLowerCase()]));
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

  test('a card ref with the null tracker routes to managers', async () => {
    const fake = await setup();
    const card: Item = {
      text: 'Card blocked',
      ref: { kind: 'card', url: 'https://linear.app/acme/issue/ENG-1' },
    };
    expect(await target(fake, card)).toEqual({ reason: 'manager', logins: ['mgr'] });
  });

  test('a card ref uses the tracker assignee when there is one', async () => {
    const fake = await setup();
    fake.deps.tracker = { blockingAssignee: async () => 'Erin' };
    const card: Item = {
      text: 'Card blocked',
      ref: { kind: 'card', url: 'https://linear.app/acme/issue/ENG-1' },
    };
    expect(await target(fake, card)).toEqual({ reason: 'card_blocker', logins: ['erin'] });
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
      subject: `${dailyId}:${blockerHash(prBlocker())}:carla`,
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
      subject: `${dailyId}:${blockerHash(blocker)}:mgr`,
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

  test('a job whose blocker was removed does nothing', async () => {
    const fake = await setup();
    const dailyId = await seedDaily([{ text: 'Other' }]);
    await routeBlocker(fake.deps, {
      installationId: INST,
      dailyId,
      blockerIndex: 0,
      blockerHash: blockerHash({ text: 'Gone' }),
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
      subject: `${dailyId}:${blockerHash(blocker)}:mgr`,
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
      subject: `${dailyId}:${blockerHash(blocker)}:-`,
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
      subject: `${dailyId}:${blockerHash(blocker)}:mgr`,
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
});
