import { afterAll, describe, expect, test } from 'bun:test';
import http from 'node:http';
import { isPublicAddress, requestPinned, SafeFetchError, safeFetch } from '../src';

const PUBLIC_V4 = '93.184.216.34';

type Call = { url: string; init: RequestInit };

function recorder(respond: (call: Call) => Promise<Response> = async () => new Response('ok')) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafeFetchError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('isPublicAddress', () => {
  const blocked: [string, string][] = [
    ['0/8', '0.0.0.0'],
    ['0/8', '0.1.2.3'],
    ['10/8', '10.0.0.5'],
    ['10/8', '10.255.255.255'],
    ['100.64/10', '100.64.0.1'],
    ['100.64/10', '100.127.255.254'],
    ['127/8', '127.0.0.1'],
    ['127/8', '127.10.0.1'],
    ['169.254/16', '169.254.169.254'],
    ['169.254/16', '169.254.0.1'],
    ['172.16/12', '172.16.0.1'],
    ['172.16/12', '172.31.255.255'],
    ['192.168/16', '192.168.1.10'],
    ['224/4', '224.0.0.1'],
    ['224/4', '239.255.255.250'],
    ['240/4', '240.0.0.1'],
    ['240/4', '255.255.255.255'],
    ['::1', '::1'],
    ['::', '::'],
    ['fc00::/7', 'fc00::1'],
    ['fc00::/7', 'fd12:3456:789a::1'],
    ['fe80::/10', 'fe80::1'],
    ['fe80::/10', 'febf::1'],
    ['ff00::/8', 'ff02::1'],
    ['mapped loopback', '::ffff:127.0.0.1'],
    ['mapped private', '::ffff:10.0.0.5'],
    ['mapped metadata', '::ffff:169.254.169.254'],
    ['mapped hex', '::ffff:a00:5'],
    ['mapped expanded', '0:0:0:0:0:ffff:c0a8:010a'],
    ['nat64', '64:ff9b::a00:5'],
    ['6to4', '2002:a00:5::1'],
    ['not an ip', 'example.com'],
    ['empty', ''],
  ];
  test.each(blocked)('blocks %s (%s)', (_label, ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  const allowed = [
    PUBLIC_V4,
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '169.255.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '::ffff:8.8.8.8',
  ];
  test.each(allowed)('allows %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe('safeFetch', () => {
  test('ssrf blocked', async () => {
    const cases: [string, (host: string) => Promise<string[]>][] = [
      ['http://hooks.example.com/x', resolveTo(PUBLIC_V4)],
      ['https://127.0.0.1/x', resolveTo(PUBLIC_V4)],
      ['https://10.0.0.5/x', resolveTo(PUBLIC_V4)],
      ['https://[::1]/x', resolveTo(PUBLIC_V4)],
      ['https://169.254.169.254/latest/meta-data', resolveTo(PUBLIC_V4)],
      ['https://hooks.example.com/x', resolveTo('192.168.1.10')],
      ['https://hooks.example.com/x', resolveTo(PUBLIC_V4, '10.0.0.1')],
      ['https://hooks.example.com/x', resolveTo('::ffff:127.0.0.1')],
      ['https://hooks.example.com/x', resolveTo()],
      ['https://user:pass@hooks.example.com/x', resolveTo(PUBLIC_V4)],
      ['not a url', resolveTo(PUBLIC_V4)],
    ];
    for (const [url, resolve] of cases) {
      const { calls, fetch } = recorder();
      const code = await codeOf(safeFetch(url, { method: 'POST' }, { resolve, fetch }));
      expect([url, code]).not.toEqual([url, 'resolved']);
      expect(calls).toHaveLength(0);
    }
  });

  test('literal ips skip the resolver', async () => {
    const resolved: string[] = [];
    const { calls, fetch } = recorder();
    await safeFetch(
      `https://${PUBLIC_V4}/x`,
      {},
      {
        resolve: async (host) => {
          resolved.push(host);
          return ['10.0.0.1'];
        },
        fetch,
      },
    );
    expect(resolved).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test('a failing resolver is reported as a dns error', async () => {
    const { calls, fetch } = recorder();
    const resolve = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await codeOf(safeFetch('https://nope.example/x', {}, { resolve, fetch }))).toBe(
      'dns_failed',
    );
    expect(calls).toHaveLength(0);
  });

  test('error codes', async () => {
    const { fetch } = recorder();
    expect(await codeOf(safeFetch('http://a.example/', {}, { fetch }))).toBe('invalid_url');
    expect(
      await codeOf(safeFetch('https://a.example/', {}, { resolve: resolveTo('10.0.0.1'), fetch })),
    ).toBe('blocked_address');
  });

  test('public destination is fetched without following redirects', async () => {
    const { calls, fetch } = recorder(
      async () => new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/' } }),
    );
    const res = await safeFetch(
      'https://hooks.example.com/x?a=1',
      { method: 'POST', body: '{}' },
      { resolve: resolveTo(PUBLIC_V4), fetch },
    );
    expect(res.status).toBe(302);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hooks.example.com/x?a=1');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test('response body is capped at 64 KB', async () => {
    const { fetch } = recorder(async () => new Response('x'.repeat(200_000)));
    const res = await safeFetch(
      'https://hooks.example.com/',
      {},
      {
        resolve: resolveTo(PUBLIC_V4),
        fetch,
      },
    );
    expect((await res.text()).length).toBe(64 * 1024);
  });

  test('times out', async () => {
    const { fetch } = recorder(
      (call) =>
        new Promise((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(call.init.signal?.reason));
        }),
    );
    const started = Date.now();
    const code = await codeOf(
      safeFetch(
        'https://hooks.example.com/',
        {},
        {
          resolve: resolveTo(PUBLIC_V4),
          fetch,
          timeoutMs: 50,
        },
      ),
    );
    expect(code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('network errors are wrapped', async () => {
    const { fetch } = recorder(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(
      await codeOf(
        safeFetch('https://hooks.example.com/', {}, { resolve: resolveTo(PUBLIC_V4), fetch }),
      ),
    ).toBe('network');
  });
});

describe('requestPinned', () => {
  const seen: { host: string | null; method: string; body: string; path: string }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url);
      seen.push({
        host: req.headers.get('host'),
        method: req.method,
        body: await req.text(),
        path: `${url.pathname}${url.search}`,
      });
      if (url.pathname === '/big') return new Response('y'.repeat(300_000));
      if (url.pathname === '/redirect') {
        return new Response(null, { status: 301, headers: { location: '/elsewhere' } });
      }
      return new Response('ok', { status: 201, headers: { 'x-reply': 'yes' } });
    },
  });
  afterAll(() => server.stop(true));

  const target = (path: string) => new URL(`https://receiver.invalid:${server.port}${path}`);

  test('connects to the validated address, keeping the original host', async () => {
    const res = await requestPinned(
      target('/hook?x=1'),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
      '127.0.0.1',
      { transport: http, signal: AbortSignal.timeout(5_000) },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('x-reply')).toBe('yes');
    expect(await res.text()).toBe('ok');
    expect(seen.at(-1)).toEqual({
      host: `receiver.invalid:${server.port}`,
      method: 'POST',
      body: '{"a":1}',
      path: '/hook?x=1',
    });
  });

  test('caps the body and does not follow redirects', async () => {
    const big = await requestPinned(target('/big'), { method: 'GET' }, '127.0.0.1', {
      transport: http,
      signal: AbortSignal.timeout(5_000),
    });
    expect((await big.text()).length).toBe(64 * 1024);
    const before = seen.length;
    const redirect = await requestPinned(target('/redirect'), { method: 'GET' }, '127.0.0.1', {
      transport: http,
      signal: AbortSignal.timeout(5_000),
    });
    expect(redirect.status).toBe(301);
    expect(seen.length).toBe(before + 1);
  });

  test('aborts on signal', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('timed out', 'TimeoutError'));
    await expect(
      requestPinned(target('/hook'), { method: 'GET' }, '127.0.0.1', {
        transport: http,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
  });
});
