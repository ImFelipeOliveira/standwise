import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli';
import { credentialsPath, readCredentials, writeCredentials } from '../src/credentials';
import { makeIo } from './support';

type Seen = { method: string; path: string; auth: string | null; body: string };
const servers: { stop(close?: boolean): void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function serve(handler: (req: Request, seen: Seen[]) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      seen.push({
        method: req.method,
        path: url.pathname + url.search,
        auth: req.headers.get('authorization'),
        body: await req.clone().text(),
      });
      return handler(req, seen);
    },
  });
  servers.push(server);
  return { url: `http://localhost:${server.port}`, seen };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const ORGS = [
  { installationId: 1, login: 'acme' },
  { installationId: 2, login: 'beta' },
];
const DAILY = { org: 'acme', yesterday: [], today: [{ text: 'ship it' }], blockers: [] };

async function loggedIn(apiUrl: string, orgs = ORGS, stdin = '', extra = {}) {
  const ctx = await makeIo({ STANDWISE_API_URL: apiUrl, ...extra }, stdin);
  await writeCredentials(ctx.io.env, { apiUrl, token: 'sw_tok', login: 'alice', orgs });
  return ctx;
}

describe('login', () => {
  test('login stores credentials with 0600', async () => {
    const polls: string[] = [];
    const github = serve(async (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/login/device/code') {
        return json({
          device_code: 'dc',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        });
      }
      polls.push(path);
      const step = polls.length;
      if (step === 1) return json({ error: 'authorization_pending' });
      if (step === 2) return json({ error: 'slow_down' });
      return json({ access_token: 'gho_user' });
    });
    const api = serve(async (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/v1/meta') return json({ githubClientId: 'cid', supportEmail: 's@x' });
      if (path === '/v1/sessions') return json({ token: 'sw_tok', login: 'alice', orgs: ORGS });
      return json({}, 404);
    });
    const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });

    const code = await run(['login'], ctx.io);

    expect(code).toBe(0);
    expect(ctx.sleeps).toEqual([5000, 5000, 10000]);
    expect(ctx.err.join('')).toContain('ABCD-1234');
    expect(ctx.err.join('')).toContain('https://github.com/login/device');
    expect(ctx.err.join('') + ctx.out.join('')).not.toContain('sw_tok');
    expect(ctx.err.join('') + ctx.out.join('')).not.toContain('gho_user');
    expect(ctx.opened).toEqual(['https://github.com/login/device']);
    const sessionCall = api.seen.find((s) => s.path === '/v1/sessions');
    expect(JSON.parse(sessionCall?.body ?? '{}')).toEqual({ githubToken: 'gho_user' });
    const form = new URLSearchParams(github.seen[0]?.body);
    expect(form.get('client_id')).toBe('cid');
    const pollForm = new URLSearchParams(github.seen[1]?.body);
    expect(pollForm.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(pollForm.get('device_code')).toBe('dc');
    const { stat } = await import('node:fs/promises');
    expect((await stat(credentialsPath(ctx.io.env))).mode & 0o777).toBe(0o600);
    expect(await readCredentials(ctx.io.env)).toEqual({
      apiUrl: api.url,
      token: 'sw_tok',
      login: 'alice',
      orgs: ORGS,
    });
  });

  test('login stops on access_denied and expired_token without saving', async () => {
    for (const [error, message] of [
      ['access_denied', 'denied'],
      ['expired_token', 'expired'],
    ] as const) {
      const github = serve((req) =>
        new URL(req.url).pathname === '/login/device/code'
          ? json({ device_code: 'd', user_code: 'U', verification_uri: 'https://v', interval: 1 })
          : json({ error }),
      );
      const api = serve(() => json({ githubClientId: 'cid', supportEmail: 's' }));
      const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });
      expect(await run(['login'], ctx.io)).toBe(1);
      expect(ctx.err.join('')).toContain(message);
      expect(await readCredentials(ctx.io.env)).toBeNull();
    }
  });

  test('login messages follow STANDWISE_LANG', async () => {
    const github = serve((req) =>
      new URL(req.url).pathname === '/login/device/code'
        ? json({ device_code: 'd', user_code: 'U-1', verification_uri: 'https://v', interval: 1 })
        : json({ error: 'access_denied' }),
    );
    const api = serve(() => json({ githubClientId: 'cid', supportEmail: 's' }));
    const ctx = await makeIo({
      STANDWISE_API_URL: api.url,
      STANDWISE_GITHUB_URL: github.url,
      STANDWISE_LANG: 'pt-BR',
    });
    await run(['login'], ctx.io);
    expect(ctx.err.join('')).toContain('informe o código: U-1');
    expect(ctx.err.join('')).toContain('negada');
  });
});

describe('logout and whoami', () => {
  test('whoami prints JSON and exits 2 when logged out', async () => {
    const out = await makeIo();
    expect(await run(['whoami'], out.io)).toBe(2);
    expect(out.err.join('')).toContain('standwise login');
    const ctx = await loggedIn('http://unused');
    expect(await run(['whoami'], ctx.io)).toBe(0);
    expect(JSON.parse(ctx.out.join(''))).toEqual({ login: 'alice', orgs: ORGS });
  });
});

describe('draft', () => {
  test('draft without login exits 2', async () => {
    const ctx = await makeIo();
    expect(await run(['draft'], ctx.io)).toBe(2);
  });

  test('draft ambiguous org exits 3', async () => {
    const api = serve(() => json({}));
    const ctx = await loggedIn(api.url);
    expect(await run(['draft'], ctx.io)).toBe(3);
    expect(ctx.err.join('')).toContain('acme');
    expect(ctx.err.join('')).toContain('beta');
    expect(api.seen).toHaveLength(0);
  });

  test('draft prints the API JSON using the single org or --org', async () => {
    const api = serve(() => json({ org: 'acme', activity: [] }));
    const single = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['draft'], single.io)).toBe(0);
    expect(JSON.parse(single.out.join(''))).toEqual({ org: 'acme', activity: [] });
    expect(api.seen[0]).toMatchObject({ path: '/v1/draft?org=acme', auth: 'Bearer sw_tok' });
    const multi = await loggedIn(api.url);
    expect(await run(['draft', '--org', 'beta'], multi.io)).toBe(0);
    expect(api.seen[1]?.path).toBe('/v1/draft?org=beta');
  });

  test('--api-url overrides STANDWISE_API_URL', async () => {
    const api = serve(() => json({ ok: true }));
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]], '', {
      STANDWISE_API_URL: 'http://localhost:1',
    });
    expect(await run(['draft', '--api-url', api.url], ctx.io)).toBe(0);
    expect(api.seen).toHaveLength(1);
  });

  test('API errors print error <code>: <message>, rate limits add the wait', async () => {
    const api = serve(() =>
      json({ error: { code: 'rate_limited', message: 'too many' } }, 429, { 'Retry-After': '12' }),
    );
    const ctx = await loggedIn(api.url);
    expect(await run(['draft', '--org', 'acme'], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('error rate_limited: too many (retry after 12s)');
    const denied = serve(() => json({ error: { code: 'unauthorized', message: 'expired' } }, 401));
    const ctx2 = await loggedIn(denied.url);
    expect(await run(['draft', '--org', 'acme'], ctx2.io)).toBe(2);
    expect(ctx2.err.join('')).toContain('error unauthorized: expired');
  });
});

describe('suggestion', () => {
  const ID = '5f0c2a8e-3b1d-4c7e-9a2f-1d6b8e4c0a17';

  test('suggestion ignore and confirm post the decision and exit 0', async () => {
    const api = serve(() => new Response(null, { status: 204 }));
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['suggestion', 'ignore', ID], ctx.io)).toBe(0);
    expect(api.seen[0]).toMatchObject({
      method: 'POST',
      path: `/v1/suggestions/${ID}/decision`,
      auth: 'Bearer sw_tok',
    });
    expect(JSON.parse(api.seen[0]?.body ?? '')).toEqual({ org: 'acme', decision: 'ignored' });
    expect(JSON.parse(ctx.out.join(''))).toEqual({ id: ID, decision: 'ignored' });
    const multi = await loggedIn(api.url);
    expect(await run(['suggestion', 'confirm', ID, '--org', 'beta'], multi.io)).toBe(0);
    expect(JSON.parse(api.seen[1]?.body ?? '')).toEqual({ org: 'beta', decision: 'confirmed' });
  });

  test('an unknown id exits 1 with error not_found', async () => {
    const api = serve(() =>
      json({ error: { code: 'not_found', message: 'suggestion not found' } }, 404),
    );
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['suggestion', 'ignore', ID], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('error not_found: suggestion not found');
  });

  test('a suggestion decided otherwise exits 1 with error suggestion_already_decided', async () => {
    const api = serve(() =>
      json(
        {
          error: { code: 'suggestion_already_decided', message: 'suggestion was already decided' },
        },
        409,
      ),
    );
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['suggestion', 'confirm', ID], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('error suggestion_already_decided');
  });

  test('a missing action or id prints the usage and exits 1 without calling the API', async () => {
    const api = serve(() => new Response(null, { status: 204 }));
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['suggestion', 'maybe', ID], ctx.io)).toBe(1);
    expect(await run(['suggestion', 'ignore'], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('standwise suggestion ignore <id>');
    expect(api.seen).toHaveLength(0);
  });

  test('the id is path encoded', async () => {
    const api = serve(() => new Response(null, { status: 204 }));
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['suggestion', 'ignore', '../draft'], ctx.io)).toBe(0);
    expect(api.seen[0]?.path).toBe('/v1/suggestions/..%2Fdraft/decision');
  });
});

describe('submit', () => {
  test('submit validates locally', async () => {
    const api = serve(() => json({}));
    const ctx = await loggedIn(api.url, ORGS, JSON.stringify({ ...DAILY, today: [] }));
    expect(await run(['submit'], ctx.io)).toBe(4);
    expect(ctx.err.join('')).toContain('today');
    expect(api.seen).toHaveLength(0);
  });

  test('submit reads stdin', async () => {
    const api = serve(() => json({ date: '2026-10-28', teams: ['A'], late: false }));
    const ctx = await loggedIn(api.url, ORGS, JSON.stringify(DAILY));
    expect(await run(['submit'], ctx.io)).toBe(0);
    expect(JSON.parse(ctx.out.join(''))).toEqual({ date: '2026-10-28', teams: ['A'], late: false });
    expect(api.seen[0]).toMatchObject({
      method: 'POST',
      path: '/v1/dailies',
      auth: 'Bearer sw_tok',
    });
    expect(JSON.parse(api.seen[0]?.body ?? '{}')).toEqual(DAILY);
  });

  test('submit reads --file and fills org from --org or the single org', async () => {
    const api = serve(() => json({ date: 'd', teams: [], late: false }));
    const { org: _org, ...noOrg } = DAILY;
    const ctx = await loggedIn(api.url);
    const file = join(ctx.home, 'daily.json');
    await mkdir(ctx.home, { recursive: true });
    await writeFile(file, JSON.stringify(noOrg));
    expect(await run(['submit', '--file', file, '--org', 'beta'], ctx.io)).toBe(0);
    expect(JSON.parse(api.seen[0]?.body ?? '{}').org).toBe('beta');
    expect(await run(['submit', '--file', file], ctx.io)).toBe(3);
    const single = await loggedIn(
      api.url,
      [ORGS[0] as (typeof ORGS)[number]],
      JSON.stringify(noOrg),
    );
    expect(await run(['submit'], single.io)).toBe(0);
    expect(JSON.parse(api.seen[1]?.body ?? '{}').org).toBe('acme');
  });

  test('submit exits 4 on invalid JSON and 1 on a missing file', async () => {
    const api = serve(() => json({}));
    const bad = await loggedIn(api.url, ORGS, '{nope');
    expect(await run(['submit'], bad.io)).toBe(4);
    const missing = await loggedIn(api.url);
    expect(await run(['submit', '--file', '/nonexistent/x.json'], missing.io)).toBe(1);
    expect(api.seen).toHaveLength(0);
  });

  test('submit without login exits 2', async () => {
    const ctx = await makeIo({}, JSON.stringify(DAILY));
    expect(await run(['submit'], ctx.io)).toBe(2);
  });
});

describe('url safety', () => {
  test('http non-local api urls are rejected for flag, env and stored credentials', async () => {
    const ctx = await loggedIn('http://evil.example', [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['draft'], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('http://evil.example');
    const flag = await makeIo();
    expect(await run(['login', '--api-url', 'http://evil.example'], flag.io)).toBe(1);
    const env = await makeIo({ STANDWISE_API_URL: 'ftp://evil.example' });
    expect(await run(['login'], env.io)).toBe(1);
  });

  test('non-local STANDWISE_GITHUB_URL is ignored with a warning', async () => {
    const api = serve(() => json({ githubClientId: 'cid', supportEmail: 's' }));
    const ctx = await makeIo({
      STANDWISE_API_URL: api.url,
      STANDWISE_GITHUB_URL: 'https://evil.example',
    });
    const seenUrls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://')) {
        seenUrls.push(url);
        return json({ error: 'access_denied' });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      expect(await run(['login'], ctx.io)).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
    expect(seenUrls).toEqual(['https://github.com/login/device/code']);
    expect(ctx.err.join('')).toContain('STANDWISE_GITHUB_URL');
  });

  test('localhost http is accepted', async () => {
    const api = serve(() => json({ org: 'acme' }));
    const ctx = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(api.url.startsWith('http://localhost')).toBe(true);
    expect(await run(['draft'], ctx.io)).toBe(0);
  });
});

describe('token origin binding', () => {
  const other127 = (url: string) => url.replace('localhost', '127.0.0.1');

  test('a different effective origin never receives the stored token', async () => {
    const stored = serve(() => json({}));
    const other = serve(() => json({}));
    const env = { STANDWISE_API_URL: other127(other.url) };
    const ctx = await loggedIn(stored.url, [ORGS[0] as (typeof ORGS)[number]], '', env);
    expect(await run(['draft'], ctx.io)).toBe(2);
    expect(await run(['logout'], ctx.io)).toBe(0);
    expect(ctx.err.join('')).toContain('standwise login --api-url');
    const submitCtx = await loggedIn(stored.url, ORGS, JSON.stringify(DAILY), env);
    expect(await run(['submit'], submitCtx.io)).toBe(2);
    expect(other.seen).toHaveLength(0);
    expect(stored.seen.every((seen) => seen.method === 'DELETE')).toBe(true);
  });

  test('--api-url to a different origin is also refused', async () => {
    const stored = serve(() => json({}));
    const other = serve(() => json({}));
    const ctx = await loggedIn(stored.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['draft', '--api-url', other127(other.url)], ctx.io)).toBe(2);
    expect(other.seen).toHaveLength(0);
  });
});

describe('logout revoke', () => {
  test('logout revokes the session on the API then deletes the file', async () => {
    const api = serve(() => new Response(null, { status: 204 }));
    const ctx = await loggedIn(api.url);
    expect(await run(['logout'], ctx.io)).toBe(0);
    expect(api.seen[0]).toMatchObject({
      method: 'DELETE',
      path: '/v1/sessions/current',
      auth: 'Bearer sw_tok',
    });
    expect(await readCredentials(ctx.io.env)).toBeNull();
  });

  test('logout still deletes the file when the API is down or answers 401', async () => {
    const ctx = await loggedIn('http://localhost:1');
    expect(await run(['logout'], ctx.io)).toBe(0);
    expect(await readCredentials(ctx.io.env)).toBeNull();
    const unauthorized = serve(() => json({ error: { code: 'unauthorized', message: 'x' } }, 401));
    const ctx2 = await loggedIn(unauthorized.url);
    expect(await run(['logout'], ctx2.io)).toBe(0);
    expect(await readCredentials(ctx2.io.env)).toBeNull();
  });
});

describe('device flow hardening', () => {
  function deviceServers(code: Record<string, unknown>, poll: () => Response) {
    const github = serve((req) =>
      new URL(req.url).pathname === '/login/device/code' ? json(code) : poll(),
    );
    const api = serve(() => json({ githubClientId: 'cid', supportEmail: 's' }));
    return { github, api };
  }

  test('stops polling after expires_in', async () => {
    const { github, api } = deviceServers(
      {
        device_code: 'd',
        user_code: 'U',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 12,
      },
      () => json({ error: 'authorization_pending' }),
    );
    const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });
    expect(await run(['login'], ctx.io)).toBe(1);
    expect(ctx.sleeps.length).toBeLessThan(5);
    expect(ctx.err.join('')).toContain('expired');
  });

  test('rejects a malformed device code response', async () => {
    const { github, api } = deviceServers(
      { device_code: 'd', user_code: 'U', verification_uri: 42, interval: 1 },
      () => json({}),
    );
    const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });
    expect(await run(['login'], ctx.io)).toBe(1);
    expect(await readCredentials(ctx.io.env)).toBeNull();
  });

  test('github network failure is a friendly error', async () => {
    const api = serve(() => json({ githubClientId: 'cid', supportEmail: 's' }));
    const ctx = await makeIo({
      STANDWISE_API_URL: api.url,
      STANDWISE_GITHUB_URL: 'http://localhost:1',
    });
    expect(await run(['login'], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('http://localhost:1');
  });

  test('only github.com or the configured test host is opened', async () => {
    for (const uri of ['file:///etc/passwd', 'https://evil.example/x', 'http://github.com/x']) {
      const { github, api } = deviceServers(
        { device_code: 'd', user_code: 'U', verification_uri: uri, interval: 1 },
        () => json({ error: 'access_denied' }),
      );
      const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });
      await run(['login'], ctx.io);
      expect(ctx.opened).toEqual([]);
      expect(ctx.err.join('')).toContain(uri);
    }
  });

  test('control characters are stripped from the printed uri', async () => {
    const { github, api } = deviceServers(
      {
        device_code: 'd',
        user_code: 'U',
        verification_uri: 'https://evil.example/\u001b[31mx',
        interval: 1,
      },
      () => json({ error: 'access_denied' }),
    );
    const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });
    await run(['login'], ctx.io);
    expect(ctx.err.join('')).not.toContain('\u001b');
  });
});

describe('api path and redirects', () => {
  test('a stored api path prefix is preserved', async () => {
    const api = serve(() => json({ org: 'acme' }));
    const ctx = await loggedIn(`${api.url}/api`, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['draft'], ctx.io)).toBe(0);
    expect(api.seen[0]?.path).toBe('/api/v1/draft?org=acme');
  });

  test('a redirect is a network error and the body is never re-sent', async () => {
    const target = serve(() => json({}));
    const api = serve(
      () => new Response(null, { status: 307, headers: { location: `${target.url}/steal` } }),
    );
    const ctx = await loggedIn(api.url, ORGS, JSON.stringify(DAILY));
    expect(await run(['submit'], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain(api.url);
    expect(target.seen).toHaveLength(0);
    const draft = await loggedIn(api.url, [ORGS[0] as (typeof ORGS)[number]]);
    expect(await run(['draft'], draft.io)).toBe(1);
    expect(target.seen).toHaveLength(0);
  });

  test('a redirect from github is a network error', async () => {
    const target = serve(() => json({}));
    const github = serve(
      () => new Response(null, { status: 307, headers: { location: `${target.url}/x` } }),
    );
    const api = serve(() => json({ githubClientId: 'cid', supportEmail: 's' }));
    const ctx = await makeIo({ STANDWISE_API_URL: api.url, STANDWISE_GITHUB_URL: github.url });
    expect(await run(['login'], ctx.io)).toBe(1);
    expect(target.seen).toHaveLength(0);
  });
});

describe('message sanitising', () => {
  test('urls in messages lose control and bidi characters', async () => {
    const ctx = await makeIo({ STANDWISE_API_URL: 'http://evil.example/\u001b[31m\u202e' });
    expect(await run(['login'], ctx.io)).toBe(1);
    const text = ctx.err.join('');
    expect(text).toContain('http://evil.example/[31m');
    expect(text).not.toContain('\u001b');
    expect(text).not.toContain('\u202e');
  });
});

describe('global flags', () => {
  test('--help prints usage, --version prints the root version', async () => {
    const help = await makeIo();
    expect(await run(['--help'], help.io)).toBe(0);
    expect(help.out.join('')).toContain('standwise <command>');
    const version = await makeIo();
    expect(await run(['--version'], version.io)).toBe(0);
    expect(version.out.join('').trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('unknown command exits 1', async () => {
    const ctx = await makeIo();
    expect(await run(['nope'], ctx.io)).toBe(1);
    expect(ctx.err.join('')).toContain('nope');
  });
});
