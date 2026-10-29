import { lookup } from 'node:dns/promises';
import type http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export const MAX_RESPONSE_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'dns_failed'
  | 'blocked_address'
  | 'timeout'
  | 'network';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export type Resolver = (host: string) => Promise<string[]>;

export type SafeFetchOptions = {
  resolve?: Resolver;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const IPV4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_BLOCKED: [string, number][] = [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

const blocked = new BlockList();
for (const [network, prefix] of IPV4_BLOCKED) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6_BLOCKED) blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(ip: string): boolean {
  if (ip.includes('%')) return false;
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

async function resolveHost(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = value.subarray(0, maxBytes - size);
    chunks.push(take);
    size += take.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks);
}

function rebuild(status: number, headers: Headers, body: Uint8Array<ArrayBuffer>): Response {
  return new Response(NULL_BODY_STATUSES.has(status) ? null : body, { status, headers });
}

async function capResponse(response: Response): Promise<Response> {
  const body = await readCapped(response.body, MAX_RESPONSE_BYTES);
  return rebuild(response.status, response.headers, body);
}

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export type PinnedRequestInit = { method?: string; headers?: HeadersInit; body?: string };

export type PinnedRequestOptions = {
  signal: AbortSignal;
  transport?: Pick<typeof https, 'request'>;
  maxBytes?: number;
};

function responseHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

export function requestPinned(
  url: URL,
  init: PinnedRequestInit,
  address: string,
  options: PinnedRequestOptions,
): Promise<Response> {
  const { signal } = options;
  const transport = options.transport ?? https;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const host = unbracket(url.hostname);
  const family = isIP(address);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body));
  return new Promise<Response>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const request = transport.request(
      {
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        headers,
        ...(isIP(host) ? {} : { servername: host }),
        lookup: pinnedLookup,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          try {
            resolve(
              rebuild(
                response.statusCode ?? 0,
                responseHeaders(response.headers),
                Buffer.concat(chunks),
              ),
            );
          } catch (error) {
            reject(error);
          }
        };
        response.on('data', (chunk: Buffer) => {
          if (size >= maxBytes) return;
          const take = chunk.subarray(0, maxBytes - size);
          chunks.push(take);
          size += take.length;
          if (size >= maxBytes) {
            finish();
            response.destroy();
          }
        });
        response.on('end', finish);
        response.on('close', finish);
        response.on('error', finish);
      },
    );
    const onAbort = () => {
      request.destroy(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    request.end(init.body);
  });
}

export async function safeFetch(
  url: string,
  init: RequestInit,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new SafeFetchError('invalid_url', 'invalid url');
  }
  if (target.protocol !== 'https:')
    throw new SafeFetchError('invalid_url', 'only https is allowed');
  if (target.username || target.password) {
    throw new SafeFetchError('invalid_url', 'credentials in the url are not allowed');
  }
  const host = unbracket(target.hostname);
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.resolve ?? resolveHost)(host);
    } catch {
      throw new SafeFetchError('dns_failed', `could not resolve ${host}`);
    }
  }
  const [first] = addresses;
  if (!first) throw new SafeFetchError('dns_failed', `no address for ${host}`);
  const rejected = addresses.find((a) => !isPublicAddress(a));
  if (rejected !== undefined) {
    throw new SafeFetchError('blocked_address', `${host} resolves to a non-public address`);
  }
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    throw new TypeError('safeFetch only sends string bodies');
  }
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    if (opts.fetch) {
      const response = await opts.fetch(target.href, { ...init, redirect: 'manual', signal });
      return await capResponse(response);
    }
    return await requestPinned(
      target,
      {
        method: init.method,
        headers: init.headers,
        body: typeof init.body === 'string' ? init.body : undefined,
      },
      first,
      { signal },
    );
  } catch (error) {
    if (timeout.aborted) throw new SafeFetchError('timeout', 'request timed out');
    throw new SafeFetchError('network', error instanceof Error ? error.message : 'network error');
  }
}
