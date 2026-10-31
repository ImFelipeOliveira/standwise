import { describe, expect, test } from 'bun:test';
import { useCleanDb } from '../../../packages/db/test/setup';
import { createTestApp } from './support';

useCleanDb();

const cases: [string, string][] = [
  ['/v1/sessions', 'invalid_request'],
  ['/v1/dailies', 'invalid_daily'],
];

async function request(path: string, init: RequestInit) {
  const { app } = createTestApp();
  const login = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ githubToken: 'gho_1' }),
  });
  const { token } = (await login.json()) as { token: string };
  return app.request(path, {
    method: 'POST',
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

describe.each(cases)('%s bad bodies', (path, code) => {
  test('malformed json is 422', async () => {
    const res = await request(path, {
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe(code);
    expect(error.message).toBe('request body must be JSON');
  });

  test('missing content-type is 422', async () => {
    const res = await request(path, { body: JSON.stringify({ githubToken: 'x' }) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  test('wrong content-type is 422', async () => {
    const res = await request(path, {
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ githubToken: 'x' }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });
});
