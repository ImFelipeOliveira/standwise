import { describe, expect, test } from 'bun:test';
import { useCleanDb } from '../../../packages/db/test/setup';
import { createTestApp } from './support';

useCleanDb();

function session(app: ReturnType<typeof createTestApp>['app'], ip?: string, token = 'gho_x') {
  return app.request('/v1/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify({ githubToken: token }),
  });
}

describe('rate limit', () => {
  test('the 11th POST /v1/sessions from the same ip in 60s is 429 with Retry-After', async () => {
    const { app } = createTestApp({ trustProxy: true });
    for (let i = 1; i <= 10; i++) {
      const ok = await session(app, '203.0.113.9');
      expect(ok.status).toBe(200);
      expect(ok.headers.get('RateLimit-Limit')).toBe('10');
      expect(ok.headers.get('RateLimit-Remaining')).toBe(String(10 - i));
      expect(ok.headers.get('RateLimit-Reset')).toBe('55');
    }
    const blocked = await session(app, '203.0.113.9');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('55');
    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0');
    expect(await blocked.json()).toEqual({
      error: { code: 'rate_limited', message: 'rate limit exceeded' },
    });
  });

  test('another ip and the next window are not blocked', async () => {
    const { app, setNow } = createTestApp({ trustProxy: true });
    for (let i = 0; i < 11; i++) await session(app, '203.0.113.9');
    expect((await session(app, '203.0.113.10')).status).toBe(200);
    setNow(new Date('2026-10-28T15:01:00Z'));
    expect((await session(app, '203.0.113.9')).status).toBe(200);
  });

  test('x-forwarded-for is ignored unless TRUST_PROXY is on', async () => {
    const { app } = createTestApp({ trustProxy: false });
    for (let i = 0; i < 10; i++) expect((await session(app, `198.51.100.${i}`)).status).toBe(200);
    expect((await session(app, '198.51.100.99')).status).toBe(429);
  });

  test('uses the first x-forwarded-for entry', async () => {
    const { app } = createTestApp({ trustProxy: true });
    for (let i = 0; i < 10; i++) await session(app, '203.0.113.9, 10.0.0.1');
    expect((await session(app, '203.0.113.9, 10.0.0.2')).status).toBe(429);
    expect((await session(app, '203.0.113.50, 10.0.0.1')).status).toBe(200);
  });

  test('session-token routes get 120/min and RateLimit headers', async () => {
    const { app } = createTestApp({ trustProxy: true });
    const login = await session(app, '203.0.113.1');
    const { token } = (await login.json()) as { token: string };
    const res = await app.request('/v1/draft?org=nope', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.headers.get('RateLimit-Limit')).toBe('120');
    expect(res.headers.get('RateLimit-Remaining')).toBe('119');
  });

  test('api-key shaped tokens get the 600/min budget', async () => {
    const { app } = createTestApp({ trustProxy: true });
    const res = await app.request('/v1/draft', { headers: { authorization: 'Bearer swk_abc' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('RateLimit-Limit')).toBe('600');
  });
});
