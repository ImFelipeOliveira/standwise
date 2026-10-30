import { describe, expect, test } from 'bun:test';
import {
  ciFailingFingerprint,
  detectPullRequestSignals,
  type PullRequestSnapshot,
  prNoReviewFingerprint,
} from '../src/signals';

const now = new Date('2026-10-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const pr = (over: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot => ({
  repo: 'acme/api',
  number: 7,
  url: 'https://github.com/acme/api/pull/7',
  title: 'Add thing',
  draft: false,
  readyAt: hoursAgo(1),
  reviewCount: 0,
  headSha: 'abc123',
  failingChecksSince: null,
  ...over,
});

describe('detectPullRequestSignals', () => {
  test('flags a PR without review after the threshold', () => {
    const out = detectPullRequestSignals([pr({ readyAt: hoursAgo(49) })], now, 48);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('pr_no_review');
    expect(out[0]?.ref).toEqual({
      kind: 'pull_request',
      url: 'https://github.com/acme/api/pull/7',
      title: 'Add thing',
    });
    expect(out[0]?.since).toEqual(hoursAgo(49));
    expect(out[0]?.fingerprint).toBe(prNoReviewFingerprint('acme/api', 7));
  });

  test('ignores a PR inside the threshold, with reviews, or in draft', () => {
    expect(detectPullRequestSignals([pr({ readyAt: hoursAgo(47) })], now, 48)).toEqual([]);
    expect(
      detectPullRequestSignals([pr({ readyAt: hoursAgo(60), reviewCount: 1 })], now, 48),
    ).toEqual([]);
    expect(detectPullRequestSignals([pr({ readyAt: hoursAgo(60), draft: true })], now, 48)).toEqual(
      [],
    );
  });

  test('flags failing checks after 24h with the head sha in the fingerprint', () => {
    const out = detectPullRequestSignals([pr({ failingChecksSince: hoursAgo(25) })], now, 48);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('ci_failing');
    expect(out[0]?.fingerprint).toContain('abc123');
    expect(out[0]?.fingerprint).toBe(ciFailingFingerprint('acme/api', 7, 'abc123'));
  });

  test('ignores failing checks under 24h and draft PRs', () => {
    expect(detectPullRequestSignals([pr({ failingChecksSince: hoursAgo(23) })], now, 48)).toEqual(
      [],
    );
    expect(
      detectPullRequestSignals([pr({ failingChecksSince: hoursAgo(30), draft: true })], now, 48),
    ).toEqual([]);
  });

  test('honours a custom ci threshold', () => {
    const prs = [pr({ failingChecksSince: hoursAgo(5) })];
    expect(detectPullRequestSignals(prs, now, 48, 4)).toHaveLength(1);
  });

  test('fingerprints are stable and change with the head sha', () => {
    expect(prNoReviewFingerprint('acme/api', 7)).toBe(prNoReviewFingerprint('acme/api', 7));
    expect(ciFailingFingerprint('acme/api', 7, 'a')).toBe(ciFailingFingerprint('acme/api', 7, 'a'));
    expect(ciFailingFingerprint('acme/api', 7, 'a')).not.toBe(
      ciFailingFingerprint('acme/api', 7, 'b'),
    );
  });

  test('thresholds are inclusive', () => {
    expect(detectPullRequestSignals([pr({ readyAt: hoursAgo(48) })], now, 48)).toHaveLength(1);
    expect(
      detectPullRequestSignals([pr({ failingChecksSince: hoursAgo(24) })], now, 48),
    ).toHaveLength(1);
  });

  test('one PR can yield both signals', () => {
    const out = detectPullRequestSignals(
      [pr({ readyAt: hoursAgo(50), failingChecksSince: hoursAgo(30) })],
      now,
      48,
    );
    expect(out.map((s) => s.kind)).toEqual(['pr_no_review', 'ci_failing']);
  });
});
