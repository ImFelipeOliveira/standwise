import { describe, expect, test } from 'bun:test';
import { fetchCodeowners } from '../src/codeowners-source';
import { fixture, octokitWith } from './helpers';

describe('fetchCodeowners', () => {
  test('reads .github/CODEOWNERS at the ref', async () => {
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: fixture('codeowners.json') },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('* @alice\n');
    expect(calls[0]?.url.searchParams.get('ref')).toBe('main');
  });

  test('falls back to the second path', async () => {
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/contents/CODEOWNERS': { body: fixture('codeowners.json') },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('* @alice\n');
    expect(calls).toHaveLength(2);
  });

  test('falls back to docs/CODEOWNERS', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/docs/CODEOWNERS': { body: fixture('codeowners.json') },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('* @alice\n');
  });

  test('three 404s give null', async () => {
    const { octokit, calls } = octokitWith({});
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBeNull();
    expect(calls).toHaveLength(3);
  });

  test('non-404 errors propagate', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { status: 500 },
    });
    await expect(fetchCodeowners(octokit, 'acme', 'api', 'main')).rejects.toThrow();
  });
});
