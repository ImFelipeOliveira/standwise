import { describe, expect, test } from 'bun:test';
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
});
