import { describe, expect, test } from 'bun:test';
import { Validator } from '@seriousme/openapi-schema-validator';
import { useCleanDb } from '../../../packages/db/test/setup';
import { STATUS } from '../src/http/errors';
import { createTestApp } from './support';

type Operation = {
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  responses: Record<string, { content?: Record<string, { example?: unknown; examples?: object }> }>;
};
type Doc = {
  openapi: string;
  info: { title: string; version: string; description: string; contact: { email: string } };
  servers: { url: string }[];
  tags: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown> };
};

useCleanDb();

async function load(path: string, headers: Record<string, string> = {}) {
  const { app } = createTestApp();
  return app.request(path, { headers });
}

async function loginToken(app: ReturnType<typeof createTestApp>['app']): Promise<string> {
  const res = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ githubToken: 'gho_x' }),
  });
  return ((await res.json()) as { token: string }).token;
}

describe('public openapi document', () => {
  test('openapi is valid', async () => {
    const res = await load('/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Doc;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Standwise API');
    expect(doc.info.version).toBe('1.2.0');
    expect(doc.info.contact.email).toBe('help@sw.test');
    expect(doc.servers).toEqual([{ url: 'https://sw.test' }]);
    expect(doc.tags.map((t) => t.name)).toEqual(['Organization', 'Webhooks', 'Meta']);
    expect(doc.components.securitySchemes.apiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    const result = await new Validator().validate(doc);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  test('every public route documented', async () => {
    const doc = (await (await load('/openapi.json')).json()) as Doc;
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/health',
      '/v1/org/blockers',
      '/v1/org/dailies',
      '/v1/org/dailies/{id}',
      '/v1/org/digests',
      '/v1/org/teams',
    ]);
    for (const operations of Object.values(doc.paths)) {
      for (const op of Object.values(operations)) {
        expect(op.summary).toBeTruthy();
        expect(op.description).toBeTruthy();
        const success = Object.entries(op.responses).filter(([s]) => s.startsWith('2'));
        expect(success.length).toBeGreaterThan(0);
        for (const [, response] of success) {
          const json = response.content?.['application/json'];
          expect(json?.example ?? json?.examples).toBeDefined();
        }
      }
    }
  });

  test('guides embedded', async () => {
    const doc = (await (await load('/openapi.json')).json()) as Doc;
    for (const heading of [
      '## Authentication',
      '## AI agents',
      '## Errors',
      '## Pagination',
      '## Rate limits',
      '## Versioning',
    ]) {
      expect(doc.info.description).toContain(heading);
    }
    expect(doc.info.description).toContain('MCP');
    expect(doc.info.description).toContain('"args":["mcp"]');
  });

  test('internal routes hidden', async () => {
    const text = await (await load('/openapi.json')).text();
    for (const path of [
      '/v1/sessions',
      '/v1/sessions/current',
      '/v1/draft',
      '/v1/dailies',
      '/v1/meta',
      '/v1/suggestions',
    ]) {
      expect(text).not.toContain(path);
    }
    expect(text).not.toContain('/webhooks/github');
  });

  test('errors guide lists every domain error code with its status', async () => {
    const doc = (await (await load('/openapi.json')).json()) as Doc;
    const webhookCodes = { invalid_signature: 401, payload_too_large: 413 };
    for (const [code, status] of Object.entries({ ...STATUS, ...webhookCodes })) {
      const row = doc.info.description.split('\n').find((l) => l.includes(`\`${code}\``));
      expect(row).toBeDefined();
      expect(row).toContain(`| ${status} |`);
    }
  });
});

describe('internal openapi document', () => {
  test('requires a session and lists the internal routes', async () => {
    const { app } = createTestApp();
    expect((await app.request('/openapi.internal.json')).status).toBe(401);
    const token = await loginToken(app);
    const res = await app.request('/openapi.internal.json', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Doc;
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/v1/dailies',
      '/v1/draft',
      '/v1/manage/blockers',
      '/v1/manage/dailies',
      '/v1/manage/digests',
      '/v1/manage/teams',
      '/v1/meta',
      '/v1/sessions',
      '/v1/sessions/current',
      '/v1/suggestions/{id}/decision',
      '/v1/today',
    ]);
    expect((await new Validator().validate(doc)).valid).toBe(true);
  });

  test('every internal operation documents its errors and examples', async () => {
    const { app } = createTestApp();
    const token = await loginToken(app);
    const doc = (await (
      await app.request('/openapi.internal.json', { headers: { authorization: `Bearer ${token}` } })
    ).json()) as Doc;
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const op of Object.values(operations)) {
        expect(op.summary).toBeTruthy();
        expect(op.description?.split('\n\n').length).toBeGreaterThanOrEqual(2);
        const statuses = Object.keys(op.responses);
        expect(statuses.some((s) => s.startsWith('2'))).toBe(true);
        if (path !== '/v1/meta') {
          const required = path === '/v1/sessions/current' ? ['401', '429'] : ['401', '422', '429'];
          for (const status of required) expect(statuses).toContain(status);
        }
        for (const [status, response] of Object.entries(op.responses)) {
          if (status === '204') continue;
          const json = response.content?.['application/json'];
          expect(json?.example ?? json?.examples, `${path} ${status}`).toBeDefined();
        }
      }
    }
    expect(Object.keys(doc.paths['/v1/draft']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['404', '409']),
    );
    expect(Object.keys(doc.paths['/v1/dailies']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['404', '409']),
    );
  });
});

describe('org parameter', () => {
  test('draft and today document org as required', async () => {
    const { app } = createTestApp();
    const token = await loginToken(app);
    const doc = (await (
      await app.request('/openapi.internal.json', { headers: { authorization: `Bearer ${token}` } })
    ).json()) as Doc;
    for (const path of ['/v1/draft', '/v1/today']) {
      const op = doc.paths[path]?.get;
      const org = op?.parameters?.find((p) => p.name === 'org' && p.in === 'query');
      expect(org?.required, path).toBe(true);
      expect(op?.description).not.toContain('optional');
      expect(op?.description).not.toContain('opcional');
    }
  });
});

describe('docs page', () => {
  test('serves the reference', async () => {
    const res = await load('/reference');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('/openapi.json');
    expect(html).toContain('Standwise API');
  });
});

describe('old docs urls', () => {
  test('/docs/api and /docs/api/ move permanently to /reference', async () => {
    for (const path of ['/docs/api', '/docs/api/']) {
      const res = await load(path);
      expect(res.status, path).toBe(301);
      expect(res.headers.get('location'), path).toBe('/reference');
    }
  });

  test('/docs, /docs/ and /docs/* move permanently to the docs site', async () => {
    const cases: [string, string][] = [
      ['/docs', 'https://docs.sw.test/'],
      ['/docs/', 'https://docs.sw.test/'],
      ['/docs/pt-BR', 'https://docs.sw.test/pt-BR'],
      ['/docs/pt-BR/', 'https://docs.sw.test/pt-BR/'],
      ['/docs/x', 'https://docs.sw.test/x'],
      ['/docs/pt-BR/admin/install', 'https://docs.sw.test/pt-BR/admin/install'],
      ['/docs/assets/app.js?v=1', 'https://docs.sw.test/assets/app.js?v=1'],
    ];
    for (const [path, location] of cases) {
      const res = await load(path);
      expect(res.status, path).toBe(301);
      expect(res.headers.get('location'), path).toBe(location);
    }
  });

  test('never redirects to a host taken from the request', async () => {
    for (const path of [
      '/docs//evil.example.com',
      '/docs/%2F%2Fevil.example.com',
      '/docs/@evil.example.com',
      '/docs/\\evil.example.com',
      '/docs/%5Cevil.example.com',
    ]) {
      const res = await load(path, { host: 'evil.example.com' });
      const location = res.headers.get('location') ?? '';
      expect(res.status, path).toBe(301);
      expect(new URL(location).origin, path).toBe('https://docs.sw.test');
    }
  });

  test('the old docs site is no longer served by the api', async () => {
    const res = await load('/docs/index.html');
    expect(res.status).toBe(301);
    expect(await res.text()).not.toContain('<html');
  });
});

describe('docs link', () => {
  test('the openapi overview links to the docs site', async () => {
    const doc = (await (await load('/openapi.json')).json()) as Doc;
    expect(doc.info.description).toContain('[Standwise docs](https://docs.sw.test/)');
    expect(doc.info.description).not.toContain('](/docs/)');
  });
});

describe('docs page security', () => {
  test('pins the scalar cdn and sends a content security policy', async () => {
    const res = await load('/reference');
    const csp = res.headers.get('content-security-policy') ?? '';
    const html = await res.text();
    const cdn = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0';
    expect(html).toContain(cdn);
    expect(csp).toContain(`script-src`);
    expect(csp).toContain(cdn);
    expect(csp).toContain('https://fonts.scalar.com');
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toMatch(/connect-src 'self' https:\/\/sw\.test(;|$)/);
    const nonce = /nonce-([A-Za-z0-9+/=_-]+)/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`nonce="${nonce}"`);
  });
});
