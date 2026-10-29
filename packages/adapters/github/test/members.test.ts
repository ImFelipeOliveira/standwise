import { describe, expect, test } from 'bun:test';
import { resolveTeamMembers } from '../src/members';
import { fixture, octokitWith } from './helpers';

describe('resolveTeamMembers', () => {
  test('resolveTeamMembers expands teams', async () => {
    const { octokit } = octokitWith({
      'GET /orgs/acme/teams/backend/members': { body: fixture('team-backend.json') },
    });
    expect(await resolveTeamMembers(octokit, 'acme', ['Alice', '@acme/backend'])).toEqual([
      'alice',
      'bob',
    ]);
  });

  test('keeps plain logins without calling the API', async () => {
    const { octokit, calls } = octokitWith({});
    expect(await resolveTeamMembers(octokit, 'acme', ['Bob', 'bob'])).toEqual(['bob']);
    expect(calls).toHaveLength(0);
  });

  test('follows pages of team members past 100', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ login: `User${i}` }));
    const { octokit, calls } = octokitWith({
      'GET /orgs/acme/teams/big/members': (url) => ({
        body: JSON.stringify(url.searchParams.get('page') === '2' ? [{ login: 'Last' }] : first),
      }),
    });
    const logins = await resolveTeamMembers(octokit, 'acme', ['@acme/big']);
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
});
