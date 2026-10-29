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
});
