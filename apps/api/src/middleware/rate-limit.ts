import { hitRateLimit } from '@standwise/db';
import { type Deps, DomainError } from '@standwise/orchestrator';
import type { Context, MiddlewareHandler } from 'hono';

export const WINDOW_SECONDS = 60;
export const IP_LIMIT = 300;
export const FAILED_AUTH_LIMIT = 20;
export const SESSION_LIMIT = 120;
export const API_KEY_LIMIT = 600;
export const SESSION_START_LIMIT = 10;

export type GetClientIp = (c: Context) => string;

export type RateLimitSubject = { key: string; limit: number };

export type RateLimitEnv = { Variables: { rateLimitSubject: RateLimitSubject } };

type ConnectionServer = { requestIP?: (request: Request) => { address: string } | null };

export function clientIpResolver(options: { trustProxy: boolean; hops: number }): GetClientIp {
  return (c) => {
    const server = (c.env as { server?: ConnectionServer } | undefined)?.server;
    if (typeof server?.requestIP !== 'function') {
      throw new Error('server connection info is required to resolve the client ip');
    }
    const connection = server.requestIP(c.req.raw)?.address;
    if (!connection) throw new Error('connection address is unavailable');
    if (!options.trustProxy) return normalizeIp(connection);
    const forwarded = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return normalizeIp(forwarded[forwarded.length - options.hops] ?? connection);
  };
}

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function normalizeIp(address: string): string {
  const bare = address.split('%')[0] ?? address;
  const mapped = MAPPED_IPV4.exec(bare);
  if (mapped?.[1]) return mapped[1];
  if (!bare.includes(':')) return bare;
  const [head = '', tail] = bare.toLowerCase().split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group || '0', 16).toString(16));
  return `${prefix.join(':')}::/64`;
}

export async function enforceRateLimit(
  deps: Deps,
  c: Context,
  key: string,
  limit: number,
): Promise<void> {
  const now = deps.now();
  const { count, windowStart } = await hitRateLimit(deps.db, key, now, WINDOW_SECONDS);
  const resetSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + WINDOW_SECONDS * 1000 - now.getTime()) / 1000),
  );
  c.header('RateLimit-Limit', String(limit));
  c.header('RateLimit-Remaining', String(Math.max(0, limit - count)));
  c.header('RateLimit-Reset', String(resetSeconds));
  if (count > limit) {
    c.header('Retry-After', String(resetSeconds));
    throw new DomainError('rate_limited', 'rate limit exceeded');
  }
}

export function ipRateLimit(
  deps: Deps,
  getClientIp: GetClientIp,
  scope: string,
  limit: number,
): MiddlewareHandler {
  return async (c, next) => {
    await enforceRateLimit(deps, c, `${scope}:ip:${getClientIp(c)}`, limit);
    await next();
  };
}

export function subjectRateLimit<E extends RateLimitEnv = RateLimitEnv>(
  deps: Deps,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const subject = c.get('rateLimitSubject');
    await enforceRateLimit(deps, c, subject.key, subject.limit);
    await next();
  };
}
