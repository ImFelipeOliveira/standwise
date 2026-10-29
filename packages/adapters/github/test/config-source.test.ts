import { describe, expect, test } from 'bun:test';
import { fetchConfigSource } from '../src/config-source';
import { fixture, octokitWith } from './helpers';

describe('fetchConfigSource', () => {
  test('config source found', async () => {
    const { octokit } = octokitWith({
      'GET /repos/acme/.github': { body: fixture('repo.json') },
      'GET /repos/acme/.github/contents/standwise.yml': { body: fixture('contents.json') },
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
      'GET /repos/acme/.github/contents/standwise.yml': { status: 404 },
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
      'GET /repos/acme/.github/contents/standwise.yml': { status: 403 },
    });
    expect(await fetchConfigSource(octokit, 'acme')).toEqual({ found: false, reason: 'no_access' });
  });
});
