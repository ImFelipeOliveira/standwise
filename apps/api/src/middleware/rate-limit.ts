import { createHash } from 'node:crypto';
import { hitRateLimit } from '@standwise/db';
import { type Deps, DomainError } from '@standwise/orchestrator';
import type { Context, MiddlewareHandler } from 'hono';

export const WINDOW_SECONDS = 60;
export const SESSION_LIMIT = 120;
export const API_KEY_LIMIT = 600;
export const SESSION_START_LIMIT = 10;

type ConnectionServer = { requestIP?: (request: Request) => { address: string } | null };

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  const server = (c.env as { server?: ConnectionServer } | undefined)?.server;
  return server?.requestIP?.(c.req.raw)?.address ?? 'unknown';
}

export function bearerToken(c: Context): string {
  const header = c.req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function tokenLimit(token: string): number {
  return token.startsWith('swk_') ? API_KEY_LIMIT : SESSION_LIMIT;
}

export function tokenOrIpKey(trustProxy: boolean): (c: Context) => string {
  return (c) => {
    const token = bearerToken(c);
    return token
      ? `token:${createHash('sha256').update(token).digest('hex')}`
      : `ip:${clientIp(c, trustProxy)}`;
  };
}

export function ipKey(scope: string, trustProxy: boolean): (c: Context) => string {
  return (c) => `${scope}:ip:${clientIp(c, trustProxy)}`;
}

export type RateLimitOptions = {
  key: (c: Context) => string;
  limit: number | ((c: Context) => number);
};

export function rateLimit(deps: Deps, options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const limit = typeof options.limit === 'function' ? options.limit(c) : options.limit;
    const now = deps.now();
    const { count, windowStart } = await hitRateLimit(deps.db, options.key(c), now, WINDOW_SECONDS);
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
    await next();
  };
}
