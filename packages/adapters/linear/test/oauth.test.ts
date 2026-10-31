import { expect, test } from 'bun:test';
import {
  exchangeLinearCode,
  LINEAR_TIMEOUT_MS,
  LinearAuthError,
  linearAuthorizeUrl,
  refreshLinearToken,
} from '../src';
import { fakeFetch, hangingFetch } from './helpers';

test('authorize url asks for app actor and read scope', () => {
  const u = new URL(
    linearAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://app/cb', state: 's1' }),
  );
  expect(u.origin + u.pathname).toBe('https://linear.app/oauth/authorize');
  expect(u.searchParams.get('actor')).toBe('app');
  expect(u.searchParams.get('scope')).toBe('read');
  expect(u.searchParams.get('response_type')).toBe('code');
  expect(u.searchParams.get('state')).toBe('s1');
  expect(u.searchParams.get('redirect_uri')).toBe('https://app/cb');
  expect(u.searchParams.get('client_id')).toBe('cid');
});

test('code exchange sends the form body and maps expires_in', async () => {
  const f = fakeFetch({
    body: JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
  });
  const before = Date.now();
  const t = await exchangeLinearCode(
    { clientId: 'cid', clientSecret: 'sec', code: 'c1', redirectUri: 'https://app/cb' },
    f.fetch,
  );
  expect(f.calls[0]?.url.toString()).toBe('https://api.linear.app/oauth/token');
  expect(f.calls[0]?.method).toBe('POST');
  expect(f.calls[0]?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
  const form = new URLSearchParams(f.calls[0]?.body);
  expect(Object.fromEntries(form)).toEqual({
    grant_type: 'authorization_code',
    code: 'c1',
    redirect_uri: 'https://app/cb',
    client_id: 'cid',
    client_secret: 'sec',
  });
  expect(t.accessToken).toBe('at');
  expect(t.refreshToken).toBe('rt');
  const exp = new Date(t.expiresAt ?? '').getTime();
  expect(exp).toBeGreaterThanOrEqual(before + 3600_000);
  expect(exp).toBeLessThan(Date.now() + 3600_000 + 1);
});

test('refresh sends refresh_token grant and null expiry without expires_in', async () => {
  const f = fakeFetch({ body: JSON.stringify({ access_token: 'at2' }) });
  const t = await refreshLinearToken(
    { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' },
    f.fetch,
  );
  expect(Object.fromEntries(new URLSearchParams(f.calls[0]?.body))).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'rt',
    client_id: 'cid',
    client_secret: 'sec',
  });
  expect(t).toEqual({ accessToken: 'at2', refreshToken: null, expiresAt: null });
});

test('token errors do not leak secrets', async () => {
  const f = fakeFetch({ status: 400, body: '{"error":"invalid_grant"}' });
  const err = await exchangeLinearCode(
    { clientId: 'cid', clientSecret: 'sec', code: 'c1', redirectUri: 'r' },
    f.fetch,
  ).catch((e: Error) => e);
  expect((err as Error).message).toBe('linear oauth http 400');
});

test('malformed token response throws', async () => {
  const f = fakeFetch({ body: '{"nope":1}' });
  await expect(
    refreshLinearToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' }, f.fetch),
  ).rejects.toThrow('linear oauth invalid response');
});

test('a revoked or invalid grant is an auth error', async () => {
  const f = fakeFetch({ status: 400, body: '{"error":"invalid_grant"}' });
  const err = await refreshLinearToken(
    { clientId: 'a', clientSecret: 'b', refreshToken: 'c' },
    f.fetch,
  ).catch((e: Error) => e);
  expect(err).toBeInstanceOf(LinearAuthError);
  expect((err as Error).message).toBe('linear oauth http 400');
});

test.each([
  [400, 'invalid_request'],
  [401, 'invalid_client'],
  [400, 'unauthorized_client'],
  [401, ''],
])('a %i %s token failure is a plain error', async (status, error) => {
  const f = fakeFetch({ status, body: error ? JSON.stringify({ error }) : '' });
  const err = await refreshLinearToken(
    { clientId: 'a', clientSecret: 'b', refreshToken: 'c' },
    f.fetch,
  ).catch((e: Error) => e);
  expect(err).not.toBeInstanceOf(LinearAuthError);
  expect((err as Error).message).toBe(`linear oauth http ${status}`);
});

test('token requests are aborted after the timeout', async () => {
  const hang = hangingFetch();
  await expect(
    exchangeLinearCode(
      { clientId: 'a', clientSecret: 'b', code: 'c', redirectUri: 'r' },
      hang.fetch,
      20,
    ),
  ).rejects.toThrow();
  await expect(
    refreshLinearToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' }, hang.fetch, 20),
  ).rejects.toThrow();
  expect(hang.aborted).toBe(2);
});

test('token requests carry the default timeout signal', async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const f = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init?.signal);
    return Response.json({ access_token: 'at' });
  }) as typeof fetch;
  await refreshLinearToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' }, f);
  expect(signals[0]).toBeInstanceOf(AbortSignal);
  expect(LINEAR_TIMEOUT_MS).toBe(10_000);
});
