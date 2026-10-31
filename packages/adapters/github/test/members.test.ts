import { describe, expect, test } from 'bun:test';
import { resolveTeamMembers } from '../src/members';
import { fixture, octokitWith } from './helpers';

describe('resolveTeamMembers', () => {
  test('resolveTeamMembers expands teams', async () => {
    const { octokit } = octokitWith({
      'GET /orgs/acme/teams/backend/members': { body: fixture('team-backend.json') },
    });
    expect(await resolveTeamMembers(octokit, 'acme', ['Alice', '@acme/backend'])).toEqual({
      logins: ['alice', 'bob'],
      missingTeams: [],
      truncatedTeams: [],
    });
  });

  test('keeps plain logins without calling the API', async () => {
    const { octokit, calls } = octokitWith({});
    expect((await resolveTeamMembers(octokit, 'acme', ['Bob', 'bob'])).logins).toEqual(['bob']);
    expect(calls).toHaveLength(0);
  });

  test('follows pages of team members past 100', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ login: `User${i}` }));
    const { octokit, calls } = octokitWith({
      'GET /orgs/acme/teams/big/members': (url) => ({
        body: JSON.stringify(url.searchParams.get('page') === '2' ? [{ login: 'Last' }] : first),
      }),
    });
    const { logins, missingTeams, truncatedTeams } = await resolveTeamMembers(octokit, 'acme', [
      '@acme/big',
    ]);
    expect(missingTeams).toEqual([]);
    expect(truncatedTeams).toEqual([]);
    expect(logins).toHaveLength(101);
    expect(logins).toContain('last');
    expect(logins).toContain('user99');
    expect(
      calls.map((c) => [c.url.searchParams.get('per_page'), c.url.searchParams.get('page')]),
    ).toEqual([
      ['100', '1'],
      ['100', '2'],
    ]);
  });

  test('stops after 50 pages', async () => {
    const { octokit, calls } = octokitWith({
      'GET /orgs/acme/teams/huge/members': (url) => ({
        body: JSON.stringify(
          Array.from({ length: 100 }, (_, i) => ({
            login: `u${url.searchParams.get('page')}-${i}`,
          })),
        ),
      }),
    });
    const result = await resolveTeamMembers(octokit, 'acme', ['@acme/huge']);
    expect(calls).toHaveLength(50);
    expect(result.logins).toHaveLength(5000);
    expect(result.truncatedTeams).toEqual(['@acme/huge']);
    expect(result.missingTeams).toEqual([]);
  });

  test('a missing team is reported and the other entries still resolve', async () => {
    const { octokit } = octokitWith({});
    expect(await resolveTeamMembers(octokit, 'acme', ['@acme/gone', 'Bob'])).toEqual({
      logins: ['bob'],
      missingTeams: ['@acme/gone'],
      truncatedTeams: [],
    });
  });
});
