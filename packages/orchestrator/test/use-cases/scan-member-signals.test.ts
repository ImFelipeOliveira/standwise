import { describe, expect, spyOn, test } from 'bun:test';
import { type PullRequestSnapshot, parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  decideSuggestion,
  deleteIdentities,
  getDelivery,
  listPendingSuggestions,
  setIdentity,
  setMemberInstallations,
} from '@standwise/db';
import { GitHubRateLimitError } from '@standwise/github';
import { suggestions } from '../../../db/src/schema';
import { db, useCleanDb } from '../../../db/test/setup';
import { scanMemberSignals } from '../../src';
import { fakeChat, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const HOUR = 3_600_000;
const NOW = new Date('2026-10-28T15:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const FP = `pr_no_review:acme/api#7@${ago(49).toISOString()}:0`;
const DISMISSED_FP = `pr_no_review:acme/api#7@${ago(49).toISOString()}:1`;

function teamConfig(directMessage = false, members = '[alice, bob]'): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [bob]
    members: ${members}
    chat: { provider: slack, channel: "#alpha" }
    signals: { direct_message: ${directMessage} }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

function pr(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    repo: 'acme/api',
    number: 7,
    url: 'https://github.com/acme/api/pull/7',
    title: 'Add cache',
    draft: false,
    readyAt: ago(49),
    reviewCount: 0,
    dismissedReviewCount: 0,
    headSha: 'aaa',
    failingChecksSince: null,
    ...overrides,
  };
}

async function setup(
  opts: {
    directMessage?: boolean;
    link?: boolean;
    accountType?: 'Organization' | 'User';
    members?: string;
  } = {},
) {
  await seedOrg(teamConfig(opts.directMessage ?? false, opts.members), {
    accountType: opts.accountType ?? 'Organization',
  });
  const alice = await seedMember('Alice', 1);
  if (opts.link !== false) await setMemberInstallations(db, alice.id, [INST]);
  await setIdentity(db, INST, alice.id, 'slack', 'UALICE');
  const snapshots: Record<string, PullRequestSnapshot[]> = { alice: [] };
  const fake = fakeDeps({ snapshots });
  fake.setNow(NOW);
  const chat = fakeChat();
  fake.deps.chatFor = async () => chat.chat;
  const pending = () => listPendingSuggestions(db, INST, alice.id);
  const scan = () => scanMemberSignals(fake.deps, { installationId: INST, login: 'Alice' });
  return { ...fake, ...chat, alice, snapshots, pending, scan };
}

async function states(memberId: string) {
  const rows = await db.select().from(suggestions);
  return rows
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    .map((r) => ({ fingerprint: r.fingerprint, state: r.state, notified: r.notifiedAt !== null }));
}

describe('scanMemberSignals', () => {
  test('a PR without review for 49h creates one pending suggestion, once', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    const first = await s.pending();
    expect(first.map((p) => [p.kind, p.fingerprint])).toEqual([['pr_no_review', FP]]);
    await s.scan();
    expect(await states(s.alice.id)).toEqual([
      { fingerprint: FP, state: 'pending', notified: false },
    ]);
    expect(s.calls.snapshots).toEqual(['alice', 'alice']);
  });

  test('a PR younger than pr_review_hours creates nothing', async () => {
    const s = await setup();
    s.snapshots.alice = [pr({ readyAt: ago(47) })];
    await s.scan();
    expect(await s.pending()).toEqual([]);
  });

  test('an ignored suggestion is not revived by a rescan', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    const [row] = await s.pending();
    expect(await decideSuggestion(db, INST, s.alice.id, row?.id as string, 'ignored')).toBe(
      'applied',
    );
    await s.scan();
    expect(await states(s.alice.id)).toEqual([
      { fingerprint: FP, state: 'ignored', notified: false },
    ]);
  });

  test('a new review resolves the pending suggestion', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    s.snapshots.alice = [pr({ reviewCount: 1 })];
    await s.scan();
    expect(await states(s.alice.id)).toEqual([
      { fingerprint: FP, state: 'resolved', notified: false },
    ]);
  });

  test('a dismissed review starts a new episode with a new pending suggestion', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    s.snapshots.alice = [pr({ reviewCount: 1 })];
    await s.scan();
    s.snapshots.alice = [pr({ dismissedReviewCount: 1 })];
    await s.scan();
    expect(await states(s.alice.id)).toEqual([
      { fingerprint: FP, state: 'resolved', notified: false },
      { fingerprint: DISMISSED_FP, state: 'pending', notified: false },
    ]);
  });

  test('an ignored suggestion returns when a review is dismissed', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    const [row] = await s.pending();
    await decideSuggestion(db, INST, s.alice.id, row?.id as string, 'ignored');
    s.snapshots.alice = [pr({ dismissedReviewCount: 1 })];
    await s.scan();
    expect(await states(s.alice.id)).toEqual([
      { fingerprint: FP, state: 'ignored', notified: false },
      { fingerprint: DISMISSED_FP, state: 'pending', notified: false },
    ]);
  });

  test('a PR marked ready again starts a new episode', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    const [row] = await s.pending();
    await decideSuggestion(db, INST, s.alice.id, row?.id as string, 'ignored');
    s.snapshots.alice = [pr({ readyAt: ago(48) })];
    await s.scan();
    expect((await s.pending()).map((p) => p.fingerprint)).toEqual([
      `pr_no_review:acme/api#7@${ago(48).toISOString()}:0`,
    ]);
  });

  test('a GitHub rate limit propagates without syncing suggestions', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    s.deps.github.listOpenPullRequestSnapshots = async () => {
      throw new GitHubRateLimitError(60);
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    const error = await s.scan().catch((e: unknown) => e);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect(logged).toContain('github_rate_limited');
    expect(logged).toContain('"retryAfterSeconds":"60"');
    expect(await states(s.alice.id)).toEqual([
      { fingerprint: FP, state: 'pending', notified: false },
    ]);
  });

  test('failing CI suggests per head sha only after 24h on that sha', async () => {
    const s = await setup();
    s.snapshots.alice = [pr({ reviewCount: 1, headSha: 'aaa', failingChecksSince: ago(25) })];
    await s.scan();
    expect((await s.pending()).map((p) => p.fingerprint)).toEqual(['ci_failing:acme/api#7@aaa']);

    s.snapshots.alice = [pr({ reviewCount: 1, headSha: 'bbb', failingChecksSince: ago(1) })];
    await s.scan();
    expect(await s.pending()).toEqual([]);

    s.setNow(new Date(NOW.getTime() + 24 * HOUR));
    await s.scan();
    expect((await s.pending()).map((p) => p.fingerprint)).toEqual(['ci_failing:acme/api#7@bbb']);
  });

  test('direct_message sends one DM per created suggestion, only to the person', async () => {
    const s = await setup({ directMessage: true });
    s.snapshots.alice = [
      pr(),
      pr({
        number: 8,
        url: 'https://github.com/acme/api/pull/8',
        title: 'Fix login',
        reviewCount: 1,
        failingChecksSince: ago(30),
      }),
    ];
    await s.scan();
    expect(s.directs.map((d) => d.userId)).toEqual(['UALICE', 'UALICE']);
    expect(s.directs[0]?.msg.fallbackText).toContain('Suggestions just for you');
    expect(s.directs[0]?.msg.fallbackText).toContain('Add cache');
    expect(s.directs[0]?.msg.fallbackText).toContain('48h');
    expect(s.directs[1]?.msg.fallbackText).toContain('Fix login');
    expect(s.directs[1]?.msg.fallbackText).toContain('24h');
    expect(s.posted).toEqual([]);
    expect(s.replies).toEqual([]);
    expect((await states(s.alice.id)).every((r) => r.notified)).toBe(true);
    const delivery = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: '2026-10-28',
      kind: 'suggestion_dm',
      subject: `${s.alice.id}:${FP}`,
    });
    expect(delivery?.status).toBe('sent');

    await s.scan();
    expect(s.directs).toHaveLength(2);
  });

  test('without direct_message no DM is sent', async () => {
    const s = await setup({ directMessage: false });
    s.snapshots.alice = [pr()];
    await s.scan();
    expect(await s.pending()).toHaveLength(1);
    expect(s.directs).toEqual([]);
    expect((await states(s.alice.id))[0]?.notified).toBe(false);
  });

  test('a person without a chat identity gets a failed delivery and no DM', async () => {
    const s = await setup({ directMessage: true });
    await deleteIdentities(db, INST, 'slack');
    s.snapshots.alice = [pr()];
    await s.scan();
    expect(s.directs).toEqual([]);
    const delivery = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: '2026-10-28',
      kind: 'suggestion_dm',
      subject: `${s.alice.id}:${FP}`,
    });
    expect(delivery?.status).toBe('failed');
    expect(delivery?.error).toBe('no_chat_identity');
    expect((await states(s.alice.id))[0]?.notified).toBe(false);
  });

  test('a failed DM is recorded and the remaining suggestions are still sent', async () => {
    const s = await setup({ directMessage: true });
    s.snapshots.alice = [pr(), pr({ number: 8, url: 'https://github.com/acme/api/pull/8' })];
    let calls = 0;
    const send = s.chat.sendDirect;
    s.chat.sendDirect = async (userId, msg) => {
      calls++;
      if (calls === 1) throw new Error('slack down');
      return send(userId, msg);
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await s.scan();
    spy.mockRestore();
    expect(s.directs).toHaveLength(1);
    const failed = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: '2026-10-28',
      kind: 'suggestion_dm',
      subject: `${s.alice.id}:${FP}`,
    });
    expect(failed?.status).toBe('failed');
  });

  test('a login without a members row linked to the installation is skipped', async () => {
    const s = await setup({ link: false });
    s.snapshots.alice = [pr()];
    await s.scan();
    await scanMemberSignals(s.deps, { installationId: INST, login: 'bob' });
    expect(s.calls.snapshots).toEqual([]);
  });

  test('a member outside every team is skipped', async () => {
    const s = await setup({ members: '[bob]' });
    s.snapshots.alice = [pr()];
    await s.scan();
    expect(s.calls.snapshots).toEqual([]);
  });

  test('the search uses the installation account type', async () => {
    const s = await setup({ accountType: 'User' });
    const seen: string[] = [];
    s.deps.github.listOpenPullRequestSnapshots = async (_o, owner, ownerType, author) => {
      seen.push(`${owner}:${ownerType}:${author}`);
      return [];
    };
    await s.scan();
    expect(seen).toEqual(['acme:User:alice']);
  });

  test('a GitHub failure is logged and rethrown without resolving pending suggestions', async () => {
    const s = await setup();
    s.snapshots.alice = [pr()];
    await s.scan();
    s.deps.github.listOpenPullRequestSnapshots = async () => {
      throw Object.assign(new Error('rate limited'), { code: 'E403' });
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await expect(s.scan()).rejects.toThrow('rate limited');
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('rate limited');
    expect(logged).toContain('E403');
    expect(await s.pending()).toHaveLength(1);
  });

  test('a scan with a date records that the day was scanned', async () => {
    const s = await setup();
    await scanMemberSignals(s.deps, { installationId: INST, login: 'alice', date: '2026-10-28' });
    const marker = await getDelivery(db, {
      installationId: INST,
      teamName: '',
      date: '2026-10-28',
      kind: 'signal_scan',
      subject: 'alice',
    });
    expect(marker?.status).toBe('sent');
  });
});
