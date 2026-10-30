import { describe, expect, test } from 'bun:test';
import { hasUnsafeChars } from '@standwise/core';
import { listActivity } from '../src/activity';
import { type Call, fixture, octokitWith } from './helpers';

function searchQueries(calls: Call[]): string[] {
  return calls
    .filter((c) => c.url.pathname.startsWith('/search'))
    .map((c) => c.url.searchParams.get('q') ?? '');
}

const since = new Date('2026-10-27T03:00:00Z');

function routes(extra: Record<string, string> = {}) {
  return {
    'GET /search/issues': (url: URL) => {
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('reviewed-by:')) return { body: fixture('search-reviews.json') };
      if (q.includes('is:merged')) return { body: fixture('search-merged.json') };
      return { body: fixture('search-prs.json') };
    },
    'GET /search/commits': { body: extra.commits ?? fixture('search-commits.json') },
    'GET /users/acme': { body: JSON.stringify({ type: 'Organization' }) },
  };
}

describe('listActivity', () => {
  test('listActivity groups commits', async () => {
    const { octokit } = octokitWith(routes());
    const items = await listActivity(octokit, 'acme', 'alice', since);
    const commits = items.filter((i) => i.kind === 'commits');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ kind: 'commits', count: 3, repo: 'acme/api' });
  });

  test('listActivity excludes own PRs from reviews', async () => {
    const { octokit, calls } = octokitWith(routes());
    await listActivity(octokit, 'acme', 'alice', since);
    const queries = searchQueries(calls);
    expect(
      queries.some((q) => q.includes('reviewed-by:alice') && q.includes('-author:alice')),
    ).toBe(true);
  });

  test('formats since as ISO date-time and scopes to the org', async () => {
    const { octokit, calls } = octokitWith(routes());
    await listActivity(octokit, 'acme', 'alice', since);
    const queries = searchQueries(calls);
    expect(queries).toHaveLength(4);
    expect(queries[0]).toBe('is:pr author:alice org:acme created:>=2026-10-27T03:00:00Z');
    expect(queries[1]).toBe('is:pr author:alice org:acme is:merged merged:>=2026-10-27T03:00:00Z');
    expect(queries[3]).toBe('author:alice org:acme committer-date:>=2026-10-27T03:00:00Z');
  });

  test('uses user qualifier for user accounts', async () => {
    const { octokit, calls } = octokitWith({
      ...routes(),
      'GET /users/alice': { body: JSON.stringify({ type: 'User' }) },
    });
    await listActivity(octokit, 'alice', 'alice', since);
    const queries = searchQueries(calls);
    expect(queries.every((q) => !q.includes('org:'))).toBe(true);
    expect(queries[0]).toContain('user:alice');
  });

  test('maps kinds, orders by date desc', async () => {
    const { octokit } = octokitWith(routes());
    const items = await listActivity(octokit, 'acme', 'alice', since);
    expect(items.map((i) => i.kind)).toEqual(['review', 'pr_merged', 'pr_opened', 'commits']);
    expect(items[0]).toMatchObject({
      title: 'Refactor db',
      repo: 'acme/web',
      url: 'https://github.com/acme/web/pull/9',
    });
    expect(items[3]?.at).toEqual(new Date('2026-10-27T11:00:00Z'));
  });

  test('caps at 50 items', async () => {
    const many = {
      items: Array.from({ length: 60 }, (_, i) => ({
        title: `PR ${i}`,
        html_url: `https://github.com/acme/api/pull/${i}`,
        repository_url: 'https://api.github.com/repos/acme/api',
        created_at: '2026-10-27T12:00:00Z',
        pull_request: { merged_at: null },
      })),
    };
    const { octokit } = octokitWith({
      'GET /search/issues': { body: JSON.stringify(many) },
      'GET /search/commits': { body: '{"items":[]}' },
    });
    expect(await listActivity(octokit, 'acme', 'alice', since)).toHaveLength(50);
  });

  test('titles are stripped of unsafe characters and capped at 200 characters', async () => {
    const hit = {
      title: `Fix\u202e login\n${'x'.repeat(300)}`,
      html_url: 'https://github.com/acme/api/pull/9',
      repository_url: 'https://api.github.com/repos/acme/api',
      created_at: '2026-10-27T12:00:00Z',
      pull_request: { merged_at: null },
    };
    const commit = {
      html_url: 'https://github.com/acme/api/commit/abc',
      commit: {
        message: `Commit\u2066 ${'y'.repeat(300)}\nbody`,
        committer: { date: '2026-10-27T12:00:00Z' },
        author: null,
      },
      repository: { full_name: 'acme/api' },
    };
    const { octokit } = octokitWith({
      ...routes({ commits: JSON.stringify({ items: [commit] }) }),
      'GET /search/issues': { body: JSON.stringify({ items: [hit] }) },
    });
    const items = await listActivity(octokit, 'acme', 'alice', since);
    for (const item of items) {
      expect(Array.from(item.title).length).toBeLessThanOrEqual(200);
      expect(hasUnsafeChars(item.title)).toBe(false);
    }
    const pr = items.find((i) => i.kind === 'pr_opened');
    expect(pr?.title.startsWith('Fix login')).toBe(true);
    expect(pr?.title.endsWith('…')).toBe(true);
    expect(Array.from(pr?.title ?? '')).toHaveLength(200);
    const commits = items.find((i) => i.kind === 'commits');
    expect(commits?.title.startsWith('Commit y')).toBe(true);
    expect(commits?.title.endsWith('…')).toBe(true);
  });
});
