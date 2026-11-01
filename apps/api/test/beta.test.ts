import { describe, expect, test } from 'bun:test';
import { useCleanDb } from '../../../packages/db/test/setup';
import { createTestApp } from './support';

useCleanDb();

const valid = {
  name: 'Ana',
  email: 'ana@acme.com',
  team_size: '6-15',
  chat: 'slack',
  tracker: 'linear',
};

function post(
  app: ReturnType<typeof createTestApp>['app'],
  fields: Record<string, string>,
  headers = {},
) {
  return app.request('/beta', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('POST /beta', () => {
  test('valid en redirects to install', async () => {
    const { app } = createTestApp();
    const res = await post(app, { ...valid, locale: 'en' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://docs.sw.test/admin/install');
  });

  test('valid pt-BR redirects to pt-BR install', async () => {
    const { app } = createTestApp();
    const res = await post(app, { ...valid, locale: 'pt-BR' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://docs.sw.test/pt-BR/admin/install');
  });

  test('invalid pt-BR redirects to landing anchor', async () => {
    const { app } = createTestApp();
    const res = await post(app, { ...valid, email: 'nope', locale: 'pt-BR' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://landing.sw.test/pt-BR/#beta-invalid');
  });

  test('invalid en redirects to the en landing anchor', async () => {
    const { app } = createTestApp();
    const res = await post(app, { locale: 'en' });
    expect(res.headers.get('location')).toBe('https://landing.sw.test/#beta-invalid');
  });

  test('json body is rejected as invalid', async () => {
    const { app } = createTestApp();
    const res = await app.request('/beta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...valid, locale: 'pt-BR' }),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://landing.sw.test/#beta-invalid');
  });

  test('sixth request in a minute is 429', async () => {
    const { app } = createTestApp();
    for (let i = 0; i < 5; i++) {
      expect((await post(app, { ...valid, locale: 'en' })).status).toBe(303);
    }
    const blocked = await post(app, { ...valid, locale: 'en' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  test('beta is absent from openapi.json paths', async () => {
    const { app } = createTestApp();
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths).some((path) => path.includes('beta'))).toBe(false);
  });

  test('Location never uses request headers', async () => {
    const { app } = createTestApp();
    const headers = { host: 'evil.example', 'x-forwarded-host': 'evil.example' };
    const ok = await post(app, { ...valid, locale: 'en' }, headers);
    expect(ok.headers.get('location')).toBe('https://docs.sw.test/admin/install');
    const bad = await post(app, { locale: 'en' }, headers);
    expect(bad.headers.get('location')).toBe('https://landing.sw.test/#beta-invalid');
  });
});
