import { describe, expect, test } from 'bun:test';
import { fetchConfigSource } from '../src/config-source';
import { fixture, octokitWith } from './helpers';

describe('fetchConfigSource', () => {
  test('config source found', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/.github': { body: fixture('repo.json') },
      'GET /repos/acme/.github/contents/standcast.yml': { body: fixture('contents.json') },
    });
    expect(await fetchConfigSource(octokit, 'acme')).toEqual({
      found: true,
      source: 'timezone: America/Sao_Paulo\n',
    });
  });

  test('config source no_repo', async () => {
    const { octokit } = octokitWith({ 'GET /repos/acme/.github': { status: 404 } });
    expect(await fetchConfigSource(octokit, 'acme')).toEqual({ found: false, reason: 'no_repo' });
  });

  test('config source no_file', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/.github': { body: fixture('repo.json') },
      'GET /repos/acme/.github/contents/standcast.yml': { status: 404 },
    });
    expect(await fetchConfigSource(octokit, 'acme')).toEqual({ found: false, reason: 'no_file' });
  });

  test('config source no_access on repo', async () => {
    const { octokit } = octokitWith({ 'GET /repos/acme/.github': { status: 403 } });
    expect(await fetchConfigSource(octokit, 'acme')).toEqual({ found: false, reason: 'no_access' });
  });

  test('config source no_access on file', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/.github': { body: fixture('repo.json') },
      'GET /repos/acme/.github/contents/standcast.yml': { status: 403 },
    });
    expect(await fetchConfigSource(octokit, 'acme')).toEqual({ found: false, reason: 'no_access' });
  });
});

describe('fetchConfigSource ref', () => {
  test('sends ref when given and omits it otherwise', async () => {
    const routes = {
      'GET /repos/acme/.github': { body: fixture('repo.json') },
      'GET /repos/acme/.github/contents/standcast.yml': { body: fixture('contents.json') },
    };
    const withRef = octokitWith(routes);
    await fetchConfigSource(withRef.octokit, 'acme', { ref: 'deadbeef' });
    const refCall = withRef.calls.find((call) => call.url.pathname.endsWith('standcast.yml'));
    expect(refCall?.url.searchParams.get('ref')).toBe('deadbeef');
    const without = octokitWith(routes);
    await fetchConfigSource(without.octokit, 'acme');
    const plain = without.calls.find((call) => call.url.pathname.endsWith('standcast.yml'));
    expect(plain?.url.searchParams.has('ref')).toBe(false);
  });
});
