import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { clientIpResolver } from '../src/middleware/rate-limit';
import { createTestApp } from './support';

useCleanDb();

type TestApp = ReturnType<typeof createTestApp>['app'];

function session(app: TestApp, ip: string, token = 'gho_1') {
  return app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-ip': ip },
    body: JSON.stringify({ githubToken: token }),
  });
}

async function login(app: TestApp, ip: string, githubToken: string): Promise<string> {
  return ((await (await session(app, ip, githubToken)).json()) as { token: string }).token;
}

function draft(app: TestApp, ip: string, token: string) {
  return app.request('/v1/draft?org=nope', {
    headers: { authorization: `Bearer ${token}`, 'x-test-ip': ip },
  });
}

describe('session start limit', () => {
  test('the 11th POST /v1/sessions from the same ip in 60s is 429 with Retry-After', async () => {
    const { app } = createTestApp();
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
    const { app, setNow } = createTestApp();
    for (let i = 0; i < 11; i++) await session(app, '203.0.113.9');
    expect((await session(app, '203.0.113.10')).status).toBe(200);
    setNow(new Date('2026-10-28T15:01:00Z'));
    expect((await session(app, '203.0.113.9')).status).toBe(200);
  });
});

describe('ip and authentication limits', () => {
  test('every /v1 request counts against a 300/min ip bucket', async () => {
    const { app } = createTestApp();
    for (let i = 0; i < 300; i++) {
      expect(
        (await app.request('/v1/meta', { headers: { 'x-test-ip': '198.51.100.1' } })).status,
      ).toBe(200);
    }
    const blocked = await app.request('/v1/meta', { headers: { 'x-test-ip': '198.51.100.1' } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const other = await app.request('/v1/meta', { headers: { 'x-test-ip': '198.51.100.2' } });
    expect(other.status).toBe(200);
  });

  test('random bearers from one ip are limited and do not create a bucket each', async () => {
    const { app } = createTestApp();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const token = `sw_${randomBytes(16).toString('hex')}`;
      statuses.push((await draft(app, '203.0.113.7', token)).status);
    }
    expect(statuses.filter((s) => s === 401)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM rate_limits`);
    expect((rows[0] as { n: number }).n).toBeLessThanOrEqual(3);
  });

  test('failed auth on openapi.internal.json uses the same failed-auth bucket', async () => {
    const { app } = createTestApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.request('/openapi.internal.json', {
        headers: { authorization: `Bearer sw_${i}`, 'x-test-ip': '203.0.113.8' },
      });
      expect(res.status).toBe(401);
    }
    const res = await app.request('/openapi.internal.json', {
      headers: { authorization: 'Bearer sw_x', 'x-test-ip': '203.0.113.8' },
    });
    expect(res.status).toBe(429);
  });

  test('a valid session has its own member bucket of 120/min', async () => {
    const { app } = createTestApp();
    const alice = await login(app, '203.0.113.1', 'gho_1');
    const bob = await login(app, '203.0.113.2', 'gho_2');
    const first = await draft(app, '203.0.113.1', alice);
    expect(first.headers.get('RateLimit-Limit')).toBe('120');
    expect(first.headers.get('RateLimit-Remaining')).toBe('119');
    for (let i = 1; i < 120; i++) await draft(app, '203.0.113.1', alice);
    const blocked = await draft(app, '203.0.113.1', alice);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const other = await draft(app, '203.0.113.2', bob);
    expect(other.status).not.toBe(429);
    expect(other.headers.get('RateLimit-Remaining')).toBe('119');
  });

  test('the same member from another ip shares the member bucket', async () => {
    const { app } = createTestApp();
    const alice = await login(app, '203.0.113.1', 'gho_1');
    await draft(app, '203.0.113.1', alice);
    const again = await draft(app, '203.0.113.5', alice);
    expect(again.headers.get('RateLimit-Remaining')).toBe('118');
  });

  test('swk_ looking tokens are not given a bigger budget', async () => {
    const { app } = createTestApp();
    const res = await draft(app, '203.0.113.3', 'swk_abc');
    expect(res.status).toBe(401);
    expect(res.headers.get('RateLimit-Limit')).not.toBe('600');
  });
});

describe('client ip resolution', () => {
  function ipOf(
    options: { trustProxy: boolean; hops: number },
    headers: Record<string, string>,
    address: string | null = '10.1.1.1',
  ) {
    const app = new Hono();
    const resolve = clientIpResolver(options);
    app.get('/', (c) => c.text(resolve(c)));
    const server = { requestIP: () => (address ? { address } : null) };
    return app.request('/', { headers }, { server });
  }

  test('ignores x-forwarded-for unless TRUST_PROXY is on', async () => {
    const res = await ipOf({ trustProxy: false, hops: 1 }, { 'x-forwarded-for': '1.2.3.4' });
    expect(await res.text()).toBe('10.1.1.1');
  });

  test('takes the right-most entry by default so a spoofed left entry is ignored', async () => {
    const res = await ipOf(
      { trustProxy: true, hops: 1 },
      { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
    );
    expect(await res.text()).toBe('203.0.113.9');
  });

  test('takes the Nth entry from the right with TRUSTED_PROXY_HOPS', async () => {
    const res = await ipOf(
      { trustProxy: true, hops: 2 },
      { 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' },
    );
    expect(await res.text()).toBe('203.0.113.9');
  });

  test('falls back to the connection when the header has fewer entries than hops', async () => {
    const res = await ipOf({ trustProxy: true, hops: 2 }, { 'x-forwarded-for': '6.6.6.6' });
    expect(await res.text()).toBe('10.1.1.1');
  });

  test('a missing server is a 500, not a shared bucket', async () => {
    const app = new Hono();
    const resolve = clientIpResolver({ trustProxy: false, hops: 1 });
    app.onError(() => new Response(null, { status: 500 }));
    app.get('/', (c) => c.text(resolve(c)));
    const res = await app.request('/');
    expect(res.status).toBe(500);
  });
});
