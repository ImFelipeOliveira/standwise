import type { Ref } from './daily';

export type SignalKind = 'pr_no_review' | 'ci_failing' | 'card_stale';

export type Signal = { kind: SignalKind; ref: Ref; fingerprint: string; since: Date };

export type PullRequestSnapshot = {
  repo: string;
  number: number;
  url: string;
  title: string;
  draft: boolean;
  readyAt: Date;
  reviewCount: number;
  dismissedReviewCount: number;
  headSha: string;
  failingChecksSince: Date | null;
};

const HOUR_MS = 3_600_000;
const DEFAULT_CI_FAILING_HOURS = 24;

export function prNoReviewFingerprint(
  repo: string,
  number: number,
  readyAt: Date,
  dismissedReviewCount: number,
): string {
  return `pr_no_review:${repo}#${number}@${readyAt.toISOString()}:${dismissedReviewCount}`;
}

export function ciFailingFingerprint(repo: string, number: number, headSha: string): string {
  return `ci_failing:${repo}#${number}@${headSha}`;
}

export function detectPullRequestSignals(
  prs: PullRequestSnapshot[],
  now: Date,
  prReviewHours: number,
  ciFailingHours: number = DEFAULT_CI_FAILING_HOURS,
): Signal[] {
  const signals: Signal[] = [];
  for (const pr of prs) {
    if (pr.draft) continue;
    const ref: Ref = { kind: 'pull_request', url: pr.url, title: pr.title };
    if (pr.reviewCount === 0 && now.getTime() - pr.readyAt.getTime() >= prReviewHours * HOUR_MS) {
      signals.push({
        kind: 'pr_no_review',
        ref,
        fingerprint: prNoReviewFingerprint(pr.repo, pr.number, pr.readyAt, pr.dismissedReviewCount),
        since: pr.readyAt,
      });
    }
    if (
      pr.failingChecksSince &&
      now.getTime() - pr.failingChecksSince.getTime() >= ciFailingHours * HOUR_MS
    ) {
      signals.push({
        kind: 'ci_failing',
        ref,
        fingerprint: ciFailingFingerprint(pr.repo, pr.number, pr.headSha),
        since: pr.failingChecksSince,
      });
    }
  }
  return signals;
}
