import { afterEach, describe, expect, test } from 'bun:test';
import { exchangeSlackCode, SLACK_SCOPES, slackAuthorizeUrl } from '../src';

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe('oauth', () => {
  test('slackAuthorizeUrl', () => {
    const u = new URL(
      slackAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://a/cb', state: 's1' }),
    );
    expect(`${u.origin}${u.pathname}`).toBe('https://slack.com/oauth/v2/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('scope')).toBe(SLACK_SCOPES.join(','));
    expect(u.searchParams.get('redirect_uri')).toBe('https://a/cb');
    expect(u.searchParams.get('state')).toBe('s1');
  });

  test('exchangeSlackCode returns team and token', async () => {
    let body: Record<string, string> = {};
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = Object.fromEntries(new URLSearchParams(await req.text()));
        return Response.json({ ok: true, access_token: 'xoxb-1', team: { id: 'T1' } });
      },
    });
    const out = await exchangeSlackCode({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'c1',
      redirectUri: 'https://a/cb',
      slackApiUrl: `http://localhost:${server.port}/api/`,
    });
    expect(out).toEqual({ teamId: 'T1', botToken: 'xoxb-1' });
    expect(body.code).toBe('c1');
  });

  test('exchangeSlackCode maps errors', async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ ok: false, error: 'invalid_code' }),
    });
    const err = await exchangeSlackCode({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'bad',
      redirectUri: 'https://a/cb',
      slackApiUrl: `http://localhost:${server.port}/api/`,
    }).catch((e) => e);
    expect(err.code).toBe('invalid_code');
  });
});
