import { describe, expect, test } from 'bun:test';
import { getUserProfile } from '../src/user';
import { fakeFetch, fixture } from './helpers';

const routes = {
  'GET /user': { body: fixture('user.json') },
  'GET /user/emails': { body: fixture('user-emails.json') },
  'GET /user/installations': { body: fixture('user-installations.json') },
};

describe('getUserProfile', () => {
  test('getUserProfile picks primary verified email', async () => {
    const { fetch, calls } = fakeFetch(routes);
    const profile = await getUserProfile('ghu_token', { fetch });
    expect(profile).toEqual({
      githubUserId: 42,
      login: 'alice',
      email: 'alice@acme.com',
      installationIds: [1, 2, 3],
    });
    expect(calls.length).toBe(3);
  });

  test('filters installations to our app', async () => {
    const { fetch } = fakeFetch(routes);
    const profile = await getUserProfile('ghu_token', { fetch, appId: 100 });
    expect(profile.installationIds).toEqual([1, 3]);
  });

  test('email is null when none is primary and verified', async () => {
    const { fetch } = fakeFetch({ ...routes, 'GET /user/emails': { body: '[]' } });
    expect((await getUserProfile('ghu_token', { fetch })).email).toBeNull();
  });
});
