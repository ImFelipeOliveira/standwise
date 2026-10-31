import { describe, expect, test } from 'bun:test';
import { GitHubRateLimitError } from '../src/errors';
import { getPullRequest, listOpenPullRequestSnapshots, listPullRequestFiles } from '../src/pulls';
import { fixture, octokitWith } from './helpers';

const ref = { owner: 'acme', repo: 'api', number: 7 };

describe('getPullRequest', () => {
  test('maps detail with requested users and teams', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/pulls/7': { body: fixture('pull.json') },
    });
    expect(await getPullRequest(octokit, ref)).toEqual({
      ref,
      url: 'https://github.com/acme/api/pull/7',
      title: 'Add login',
      author: 'alice',
      state: 'open',
      draft: false,
      headSha: 'abc123',
      baseRef: 'main',
      requestedReviewers: ['bob'],
      requestedTeams: ['backend'],
    });
  });

  test('404 gives null', async () => {
    const { octokit } = octokitWith({});
    expect(await getPullRequest(octokit, ref)).toBeNull();
  });

  test('other errors propagate', async () => {
    const { octokit } = octokitWith({ 'GET /repos/acme/api/pulls/7': { status: 500 } });
    await expect(getPullRequest(octokit, ref)).rejects.toThrow();
  });
});

describe('listPullRequestFiles', () => {
  test('paginates with per_page=100', async () => {
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ filename: `a${i}` })));
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/pulls/7/files': (url) =>
        url.searchParams.get('page') === '1'
          ? { body: full }
          : { body: JSON.stringify([{ filename: 'last' }]) },
    });
    const files = await listPullRequestFiles(octokit, ref);
    expect(files).toHaveLength(101);
    expect(files[100]).toBe('last');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('100');
  });

  test('stops at 30 pages', async () => {
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ filename: `a${i}` })));
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/pulls/7/files': { body: full },
    });
    expect(await listPullRequestFiles(octokit, ref)).toHaveLength(3000);
    expect(calls).toHaveLength(30);
  });
});

function snapshotRoutes(reviews: string, checks: string) {
  return {
    'GET /search/issues': { body: fixture('search-open-prs.json') },
    'GET /repos/acme/api/pulls/7': { body: fixture('pull.json') },
    'GET /repos/acme/api/pulls/7/reviews': { body: fixture(reviews) },
    'GET /repos/acme/api/issues/7/timeline': { body: fixture('timeline-ready.json') },
    'GET /repos/acme/api/commits/abc123/check-runs': { body: fixture(checks) },
  };
}

describe('listOpenPullRequestSnapshots', () => {
  test('dismissed-only review counts as zero', async () => {
    const { octokit } = octokitWith(
      snapshotRoutes('reviews-dismissed.json', 'check-runs-failing.json'),
    );
    const [snapshot] = await listOpenPullRequestSnapshots(octokit, 'acme', 'Organization', 'alice');
    expect(snapshot).toEqual({
      repo: 'acme/api',
      number: 7,
      url: 'https://github.com/acme/api/pull/7',
      title: 'Add login',
      draft: false,
      readyAt: new Date('2026-10-26T09:00:00Z'),
      reviewCount: 0,
      dismissedReviewCount: 1,
      headSha: 'abc123',
      failingChecksSince: new Date('2026-10-27T07:00:00Z'),
    });
  });

  test('counts approved, changes requested and commented only', async () => {
    const { octokit } = octokitWith(
      snapshotRoutes('reviews-approved.json', 'check-runs-failing.json'),
    );
    const [snapshot] = await listOpenPullRequestSnapshots(octokit, 'acme', 'Organization', 'alice');
    expect(snapshot?.reviewCount).toBe(2);
    expect(snapshot?.dismissedReviewCount).toBe(1);
  });

  test('reviews by the PR author are ignored', async () => {
    const { octokit } = octokitWith(
      snapshotRoutes('reviews-with-author.json', 'check-runs-recovered.json'),
    );
    const [snapshot] = await listOpenPullRequestSnapshots(octokit, 'acme', 'Organization', 'alice');
    expect(snapshot?.reviewCount).toBe(1);
    expect(snapshot?.dismissedReviewCount).toBe(2);
  });

  test('a secondary rate limit becomes a typed error with the retry-after hint', async () => {
    const { octokit } = octokitWith({
      'GET /search/issues': {
        status: 403,
        body: '{"message":"You have exceeded a secondary rate limit"}',
        headers: { 'retry-after': '60' },
      },
    });
    const error = await listOpenPullRequestSnapshots(
      octokit,
      'acme',
      'Organization',
      'alice',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(60);
  });

  test('a primary rate limit uses x-ratelimit-reset', async () => {
    const reset = Math.floor(Date.now() / 1000) + 300;
    const { octokit } = octokitWith({
      ...snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
      'GET /repos/acme/api/pulls/7/reviews': {
        status: 429,
        body: '{"message":"API rate limit exceeded"}',
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      },
    });
    const error = await listOpenPullRequestSnapshots(
      octokit,
      'acme',
      'Organization',
      'alice',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    const seconds = (error as GitHubRateLimitError).retryAfterSeconds;
    expect(seconds).toBeGreaterThan(290);
    expect(seconds).toBeLessThanOrEqual(300);
  });

  test('a 403 without rate limit headers is not a rate limit', async () => {
    const { octokit } = octokitWith({
      'GET /search/issues': {
        status: 403,
        body: '{"message":"Forbidden"}',
        headers: { 'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': '1999999999' },
      },
    });
    const error = await listOpenPullRequestSnapshots(
      octokit,
      'acme',
      'Organization',
      'alice',
    ).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(GitHubRateLimitError);
    expect((error as { status?: number }).status).toBe(403);
  });

  test('later green run of the same check clears failure', async () => {
    const { octokit } = octokitWith(
      snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
    );
    const [snapshot] = await listOpenPullRequestSnapshots(octokit, 'acme', 'Organization', 'alice');
    expect(snapshot?.failingChecksSince).toBeNull();
  });

  test('readyAt falls back to created_at', async () => {
    const { octokit } = octokitWith({
      ...snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
      'GET /repos/acme/api/issues/7/timeline': { body: '[]' },
    });
    const [snapshot] = await listOpenPullRequestSnapshots(octokit, 'acme', 'Organization', 'alice');
    expect(snapshot?.readyAt).toEqual(new Date('2026-10-25T10:00:00Z'));
  });

  test('query uses org: for organizations and user: for users, capped at 30', async () => {
    const org = octokitWith(snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'));
    await listOpenPullRequestSnapshots(org.octokit, 'acme', 'Organization', 'alice');
    const orgSearch = org.calls.find((call) => call.url.pathname === '/search/issues');
    expect(orgSearch?.url.searchParams.get('q')).toBe(
      'is:pr is:open draft:false author:alice org:acme',
    );
    expect(orgSearch?.url.searchParams.get('per_page')).toBe('30');
    const user = octokitWith(snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'));
    await listOpenPullRequestSnapshots(user.octokit, 'acme', 'User', 'alice');
    const userSearch = user.calls.find((call) => call.url.pathname === '/search/issues');
    expect(userSearch?.url.searchParams.get('q')).toBe(
      'is:pr is:open draft:false author:alice user:acme',
    );
  });

  test('no hits gives empty list', async () => {
    const { octokit } = octokitWith({ 'GET /search/issues': { body: '{"items":[]}' } });
    expect(await listOpenPullRequestSnapshots(octokit, 'acme', 'Organization', 'alice')).toEqual(
      [],
    );
  });

  describe('pagination', () => {
    const reviewPage = (page: number) =>
      JSON.stringify(
        Array.from({ length: page === 1 ? 100 : 50 }, (_, i) => ({
          state: page === 2 && i === 0 ? 'APPROVED' : 'PENDING',
          user: { login: `r${page}-${i}` },
        })),
      );

    test('reviews are counted across pages', async () => {
      const { octokit, calls } = octokitWith({
        ...snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
        'GET /repos/acme/api/pulls/7/reviews': (url) => ({
          body: reviewPage(Number(url.searchParams.get('page'))),
        }),
      });
      const [snapshot] = await listOpenPullRequestSnapshots(
        octokit,
        'acme',
        'Organization',
        'alice',
      );
      expect(snapshot?.reviewCount).toBe(1);
      expect(calls.filter((call) => call.url.pathname.endsWith('/reviews'))).toHaveLength(2);
    });

    test('the last ready_for_review across pages wins', async () => {
      const filler = Array.from({ length: 99 }, () => ({ event: 'commented' }));
      const { octokit } = octokitWith({
        ...snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
        'GET /repos/acme/api/issues/7/timeline': (url) => ({
          body: JSON.stringify(
            url.searchParams.get('page') === '1'
              ? [...filler, { event: 'ready_for_review', created_at: '2026-10-20T00:00:00Z' }]
              : [{ event: 'ready_for_review', created_at: '2026-10-25T00:00:00Z' }],
          ),
        }),
      });
      const [snapshot] = await listOpenPullRequestSnapshots(
        octokit,
        'acme',
        'Organization',
        'alice',
      );
      expect(snapshot?.readyAt).toEqual(new Date('2026-10-25T00:00:00Z'));
    });

    test('a failing check on page 2 is detected and filter=latest is sent', async () => {
      const ok = (name: string) => ({
        name,
        conclusion: 'success',
        completed_at: '2026-10-27T09:00:00Z',
      });
      const { octokit, calls } = octokitWith({
        ...snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
        'GET /repos/acme/api/commits/abc123/check-runs': (url) => ({
          body: JSON.stringify({
            total_count: 120,
            check_runs:
              url.searchParams.get('page') === '1'
                ? Array.from({ length: 100 }, (_, i) => ok(`c${i}`))
                : [
                    ...Array.from({ length: 19 }, (_, i) => ok(`d${i}`)),
                    { name: 'e2e', conclusion: 'failure', completed_at: '2026-10-27T08:00:00Z' },
                  ],
          }),
        }),
      });
      const [snapshot] = await listOpenPullRequestSnapshots(
        octokit,
        'acme',
        'Organization',
        'alice',
      );
      expect(snapshot?.failingChecksSince).toEqual(new Date('2026-10-27T08:00:00Z'));
      const checkCalls = calls.filter((call) => call.url.pathname.endsWith('/check-runs'));
      expect(checkCalls).toHaveLength(2);
      expect(checkCalls[0]?.url.searchParams.get('filter')).toBe('latest');
    });

    test('each paginated read stops at 10 pages', async () => {
      const { octokit, calls } = octokitWith({
        ...snapshotRoutes('reviews-dismissed.json', 'check-runs-recovered.json'),
        'GET /repos/acme/api/pulls/7/reviews': {
          body: JSON.stringify(Array.from({ length: 100 }, () => ({ state: 'COMMENTED' }))),
        },
        'GET /repos/acme/api/issues/7/timeline': {
          body: JSON.stringify(Array.from({ length: 100 }, () => ({ event: 'commented' }))),
        },
        'GET /repos/acme/api/commits/abc123/check-runs': {
          body: JSON.stringify({
            check_runs: Array.from({ length: 100 }, (_, i) => ({
              name: `c${i}`,
              conclusion: 'success',
              completed_at: '2026-10-27T09:00:00Z',
            })),
          }),
        },
      });
      const [snapshot] = await listOpenPullRequestSnapshots(
        octokit,
        'acme',
        'Organization',
        'alice',
      );
      expect(snapshot?.reviewCount).toBe(1000);
      for (const suffix of ['/reviews', '/timeline', '/check-runs']) {
        expect(calls.filter((call) => call.url.pathname.endsWith(suffix))).toHaveLength(10);
      }
    });
  });
});
