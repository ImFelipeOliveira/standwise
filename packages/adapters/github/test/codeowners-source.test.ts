import { describe, expect, test } from 'bun:test';
import { fetchCodeowners } from '../src/codeowners-source';
import { octokitWith } from './helpers';

const RAW = { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' };

describe('fetchCodeowners', () => {
  test('reads .github/CODEOWNERS at the ref', async () => {
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: '* @alice\n', headers: RAW },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('* @alice\n');
    expect(calls[0]?.url.searchParams.get('ref')).toBe('main');
  });

  test('falls back to the second path', async () => {
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/contents/CODEOWNERS': { body: '* @alice\n', headers: RAW },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('* @alice\n');
    expect(calls).toHaveLength(2);
  });

  test('falls back to docs/CODEOWNERS', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/docs/CODEOWNERS': { body: '* @alice\n', headers: RAW },
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

  test('requests the raw media type', async () => {
    const { octokit, calls } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: '* @alice\n', headers: RAW },
    });
    await fetchCodeowners(octokit, 'acme', 'api', 'main');
    expect(calls[0]?.headers.get('accept')).toContain('application/vnd.github.raw+json');
  });

  test('a 1.5 MB file comes back whole', async () => {
    const big = '* @alice\n'.repeat(170000);
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: big, headers: RAW },
    });
    const text = await fetchCodeowners(octokit, 'acme', 'api', 'main');
    expect(big.length).toBeGreaterThan(1_500_000);
    expect(text).toBe(big);
  });

  test('an empty file returns an empty string', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: '', headers: RAW },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('');
  });

  test('a body that is valid JSON comes back as the string', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: '{}', headers: RAW },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('{}');
  });

  test('a binary body is decoded as utf8', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/api/contents/.github/CODEOWNERS': { body: '* @alicé\n', headers: RAW },
    });
    expect(await fetchCodeowners(octokit, 'acme', 'api', 'main')).toBe('* @alicé\n');
  });
});
