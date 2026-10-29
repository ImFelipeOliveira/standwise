import { describe, expect, test } from 'bun:test';
import { exchangeWebCode, githubAuthorizeUrl } from '../src/oauth';

describe('github web oauth', () => {
  test('exchanges the code for a user token', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ access_token: 'ghu_abc' });
    }) as unknown as typeof fetch;
    const token = await exchangeWebCode(
      { clientId: 'cid', clientSecret: 'sec', code: 'c1' },
      { fetch: fakeFetch },
    );
    expect(token).toBe('ghu_abc');
    expect(seen).toEqual([
      {
        url: 'https://github.com/login/oauth/access_token',
        body: { client_id: 'cid', client_secret: 'sec', code: 'c1' },
      },
    ]);
  });

  test('rejects an oauth error response', async () => {
    const fakeFetch = (async () =>
      Response.json({ error: 'bad_verification_code' })) as unknown as typeof fetch;
    await expect(
      exchangeWebCode({ clientId: 'c', clientSecret: 's', code: 'x' }, { fetch: fakeFetch }),
    ).rejects.toThrow('bad_verification_code');
  });

  test('builds the authorize url', () => {
    const url = new URL(
      githubAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://a/b', state: 's' }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('state')).toBe('s');
  });
});
