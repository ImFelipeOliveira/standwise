import { describe, expect, spyOn, test } from 'bun:test';
import {
  type ActivityItem,
  clampTitle,
  DailySubmissionSchema,
  parseConfig,
  TITLE_MAX,
} from '@standcast/core';
import {
  decideSuggestion,
  listPendingSuggestions,
  saveConnection,
  setIdentity,
  setMemberInstallations,
  syncSuggestions,
  upsertDaily,
} from '@standcast/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, getDraft, submitDaily } from '../../src';
import { config, daily, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup(cfg = config()) {
  await seedOrg(cfg);
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

const KEY = new Uint8Array(32).fill(7);

function trackerConfig() {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#alpha" }
    tracker: { provider: linear, team: ENG }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

async function connectLinear() {
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

const pr = (n: number, at: string): ActivityItem => ({
  kind: 'pr_opened',
  title: `PR ${n}`,
  url: `https://github.com/acme/api/pull/${n}`,
  repo: 'acme/api',
  at: new Date(at),
});

const node = (n: number, extra: Record<string, unknown>) => ({
  id: `i${n}`,
  identifier: `ENG-${n}`,
  url: `https://linear.app/acme/issue/ENG-${n}/card`,
  title: `Card ${n}`,
  startedAt: null,
  completedAt: null,
  ...extra,
});

async function setupCards() {
  const ctx = await setup(trackerConfig());
  await connectLinear();
  await setIdentity(db, INST, ctx.member.id, 'linear', 'u1');
  return ctx;
}

describe('getDraft with linear cards', () => {
  test('merges cards with pull requests newest first', async () => {
    const { deps, isMember, member, linear } = await setupCards();
    deps.github.listActivity = async () => [
      pr(1, '2026-10-27T15:00:00Z'),
      pr(2, '2026-10-27T11:00:00Z'),
    ];
    linear.state.activity = [
      node(1, { startedAt: '2026-10-27T13:00:00Z' }),
      node(2, { completedAt: '2026-10-27T17:00:00Z', startedAt: '2026-10-27T09:00:00Z' }),
    ];
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.activity.map((a) => [a.kind, a.title])).toEqual([
      ['card_done', 'Card 2'],
      ['pr_opened', 'PR 1'],
      ['card_started', 'Card 1'],
      ['pr_opened', 'PR 2'],
    ]);
    expect(linear.calls.queries[0]?.variables.teamKey).toBe('ENG');
    expect(linear.calls.queries[0]?.variables.since).toBe('2026-10-27T03:00:00.000Z');
  });

  test('card titles are clamped', async () => {
    const { deps, isMember, member, linear } = await setupCards();
    const raw = `Fix\tthe ${'x'.repeat(300)}`;
    linear.state.activity = [node(1, { startedAt: '2026-10-27T13:00:00Z', title: raw })];
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.activity[0]?.title).toBe(clampTitle(raw));
  });

  test('a person without a linear identity gets no linear call', async () => {
    const { deps, isMember, member, linear } = await setup(trackerConfig());
    await connectLinear();
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.activity).toEqual([]);
    expect(linear.calls.queries).toEqual([]);
  });

  test('without a connection there is no linear call', async () => {
    const { deps, isMember, member, linear } = await setup(trackerConfig());
    await setIdentity(db, INST, member.id, 'linear', 'u1');
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.activity).toEqual([]);
    expect(linear.calls.bearer).toEqual([]);
  });

  test('a tracker error leaves the draft without cards', async () => {
    const { deps, isMember, member, linear } = await setupCards();
    deps.github.listActivity = async () => [pr(1, '2026-10-27T15:00:00Z')];
    linear.state.graphqlStatus = 500;
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    const draft = await getDraft(deps, isMember, member, 'acme');
    spy.mockRestore();
    expect(draft.activity.map((a) => a.title)).toEqual(['PR 1']);
  });

  test('the 50 item cap applies across both sources', async () => {
    const { deps, isMember, member, linear } = await setupCards();
    deps.github.listActivity = async () =>
      Array.from({ length: 40 }, (_, i) =>
        pr(i, new Date(Date.UTC(2026, 9, 27, 4, i)).toISOString()),
      );
    linear.state.activity = Array.from({ length: 20 }, (_, i) =>
      node(i, { startedAt: new Date(Date.UTC(2026, 9, 27, 6, i)).toISOString() }),
    );
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.activity).toHaveLength(50);
    expect(draft.activity.filter((a) => a.kind === 'card_started')).toHaveLength(20);
    expect(draft.activity.filter((a) => a.kind === 'pr_opened')).toHaveLength(30);
  });
});

describe('getDraft concurrency', () => {
  test('github and linear calls start before either resolves', async () => {
    const { deps, isMember, member } = await setupCards();
    const started: string[] = [];
    let releaseGithub: (items: ActivityItem[]) => void = () => {};
    deps.github.listActivity = () => {
      started.push('github');
      return new Promise<ActivityItem[]>((resolve) => {
        releaseGithub = resolve;
      });
    };
    let releaseCards: (items: ActivityItem[]) => void = () => {};
    deps.trackerFor = async () =>
      ({
        connected: true,
        listActivity: () => {
          started.push('linear');
          return new Promise<ActivityItem[]>((resolve) => {
            releaseCards = resolve;
          });
        },
      }) as never;
    const draft = getDraft(deps, isMember, member, 'acme');
    for (let i = 0; i < 100 && started.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(started.sort()).toEqual(['github', 'linear']);
    releaseGithub([pr(1, '2026-10-27T15:00:00Z')]);
    releaseCards([]);
    expect((await draft).activity.map((a) => a.title)).toEqual(['PR 1']);
  });

  test('a github failure still rejects the draft', async () => {
    const { deps, isMember, member } = await setupCards();
    deps.github.listActivity = async () => {
      throw new Error('github down');
    };
    await expect(getDraft(deps, isMember, member, 'acme')).rejects.toThrow('github down');
  });
});

describe('getDraft', () => {
  test('since window starts at the previous workday', async () => {
    const { deps, isMember, member, calls } = await setup();
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft).toEqual({
      org: 'acme',
      date: '2026-10-28',
      since: '2026-10-27T03:00:00.000Z',
      teams: ['Alpha'],
      activity: [],
      suggestions: [],
    });
    expect(calls.activity[0]?.toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });

  test('renamed member lists activity with the new login on the first request', async () => {
    const { deps, isMember, member, calls, users, orgMembers } = await setup(
      config('[alice-new, bob]'),
    );
    users.set(1, 'alice-new');
    orgMembers.add('alice-new');
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.teams).toEqual(['Alpha']);
    expect(calls.activityLogins).toEqual(['alice-new']);
  });

  test('since window starts at the last daily submitted on the previous workday', async () => {
    const { deps, isMember, member } = await setup();
    const submittedAt = new Date('2026-10-27T20:00:00Z');
    await upsertDaily(db, {
      installationId: INST,
      memberId: member.id,
      date: '2026-10-27',
      payload: daily,
      submittedAt,
    });
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.since).toBe(submittedAt.toISOString());
  });

  test('lists only the pending suggestions of the member', async () => {
    const { deps, isMember, member } = await setup();
    const bob = await seedMember('bob', 2);
    const signal = (n: number, kind: 'pr_no_review' | 'ci_failing') => ({
      kind,
      ref: { kind: 'pull_request' as const, url: `https://github.com/acme/api/pull/${n}` },
      fingerprint: `fp-${n}`,
      since: new Date('2026-10-26T00:00:00Z'),
    });
    const { created } = await syncSuggestions(
      db,
      INST,
      member.id,
      [],
      [signal(1, 'pr_no_review'), signal(2, 'ci_failing'), signal(3, 'ci_failing')],
    );
    await syncSuggestions(db, INST, bob.id, [], [signal(4, 'pr_no_review')]);
    const byFp = (fp: string) => {
      const row = created.find((c) => c.fingerprint === fp);
      if (!row) throw new Error('seed failed');
      return row;
    };
    await decideSuggestion(db, INST, member.id, byFp('fp-2').id, 'ignored');
    await decideSuggestion(db, INST, member.id, byFp('fp-3').id, 'confirmed');
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.suggestions).toEqual([
      {
        id: byFp('fp-1').id,
        kind: 'pr_no_review',
        ref: { kind: 'pull_request', url: 'https://github.com/acme/api/pull/1' },
        since: byFp('fp-1').createdAt.toISOString(),
      },
    ]);
  });

  test('suggestion titles are clamped so the ref is valid in a submitted blocker', async () => {
    const { deps, isMember, member } = await setup();
    const url = 'https://github.com/acme/api/pull/9';
    const raw = `Fix\tthe ${'x'.repeat(242)}`;
    expect(Array.from(raw)).toHaveLength(250);
    await syncSuggestions(
      db,
      INST,
      member.id,
      [],
      [
        {
          kind: 'ci_failing',
          ref: { kind: 'pull_request', url, title: raw },
          fingerprint: 'fp-long',
          since: new Date('2026-10-26T00:00:00Z'),
        },
      ],
    );
    const draft = await getDraft(deps, isMember, member, 'acme');
    const ref = draft.suggestions[0]?.ref;
    if (!ref) throw new Error('missing suggestion');
    expect(ref.title).toBe(clampTitle(raw));
    expect(ref.title).not.toContain('\t');
    expect(Array.from(ref.title ?? '')).toHaveLength(TITLE_MAX);
    const blocker = { text: 'CI is red on the fix', ref };
    expect(DailySubmissionSchema.safeParse({ ...daily, blockers: [blocker] }).success).toBe(true);
    const result = await submitDaily(deps, isMember, member, { ...daily, blockers: [blocker] });
    expect(result.date).toBe('2026-10-28');
    expect(await listPendingSuggestions(db, INST, member.id)).toEqual([]);
  });
});
