import { expect, test } from 'bun:test';
import { createLinearClient, LinearAuthError, LinearRateLimitError } from '../src';
import { fakeFetch } from './helpers';

test('posts query and variables to the graphql host with bearer token', async () => {
  const f = fakeFetch({ body: '{"data":{"ok":true}}' });
  const data = await createLinearClient('tok', f.fetch).query<{ ok: boolean }>('query { x }', {
    a: 1,
  });
  expect(data).toEqual({ ok: true });
  const call = f.calls[0];
  expect(call?.url.toString()).toBe('https://api.linear.app/graphql');
  expect(call?.method).toBe('POST');
  expect(call?.headers.get('authorization')).toBe('Bearer tok');
  expect(JSON.parse(call?.body ?? '')).toEqual({ query: 'query { x }', variables: { a: 1 } });
});

test('http 401 is an auth error', async () => {
  const f = fakeFetch({ status: 401, body: '{}' });
  await expect(createLinearClient('tok', f.fetch).query('q', {})).rejects.toBeInstanceOf(
    LinearAuthError,
  );
});

test('graphql AUTHENTICATION_ERROR is an auth error', async () => {
  const f = fakeFetch({
    body: JSON.stringify({
      errors: [{ message: 'x', extensions: { code: 'AUTHENTICATION_ERROR' } }],
    }),
  });
  await expect(createLinearClient('tok', f.fetch).query('q', {})).rejects.toBeInstanceOf(
    LinearAuthError,
  );
});

test('RATELIMITED carries the reset hint in seconds', async () => {
  const reset = Date.now() + 30_000;
  const f = fakeFetch({
    status: 400,
    headers: { 'x-ratelimit-requests-reset': String(reset) },
    body: JSON.stringify({ errors: [{ message: 'slow', extensions: { code: 'RATELIMITED' } }] }),
  });
  const err = await createLinearClient('tok', f.fetch)
    .query('q', {})
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(LinearRateLimitError);
  const secs = (err as LinearRateLimitError).retryAfterSeconds ?? -1;
  expect(secs).toBeGreaterThan(25);
  expect(secs).toBeLessThanOrEqual(30);
});

test('http 429 uses Retry-After, null when absent', async () => {
  const a = fakeFetch({ status: 429, headers: { 'retry-after': '7' } });
  const e1 = await createLinearClient('t', a.fetch)
    .query('q', {})
    .catch((e: unknown) => e);
  expect((e1 as LinearRateLimitError).retryAfterSeconds).toBe(7);
  const b = fakeFetch({ status: 429 });
  const e2 = await createLinearClient('t', b.fetch)
    .query('q', {})
    .catch((e: unknown) => e);
  expect((e2 as LinearRateLimitError).retryAfterSeconds).toBeNull();
});

test('other graphql errors expose only code and message, never the token', async () => {
  const f = fakeFetch({
    body: JSON.stringify({
      errors: [{ message: 'bad input', extensions: { code: 'INVALID_INPUT' } }],
    }),
  });
  const err = (await createLinearClient('secret-token', f.fetch)
    .query('q', {})
    .catch((e: unknown) => e)) as Error;
  expect(err.message).toBe('INVALID_INPUT: bad input');
  expect(err.message).not.toContain('secret-token');
});

test('non-json server error reports the status only', async () => {
  const f = fakeFetch({ status: 502, body: 'bad gateway' });
  await expect(createLinearClient('tok', f.fetch).query('q', {})).rejects.toThrow(
    'linear http 502',
  );
});
