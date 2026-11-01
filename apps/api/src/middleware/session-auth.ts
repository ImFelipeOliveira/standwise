import { type MemberRow, resolveSession } from '@standcast/db';
import { type Deps, DomainError } from '@standcast/orchestrator';
import type { MiddlewareHandler } from 'hono';
import {
  enforceRateLimit,
  FAILED_AUTH_LIMIT,
  type GetClientIp,
  type RateLimitEnv,
  SESSION_LIMIT,
} from './rate-limit';

export type SessionEnv = RateLimitEnv & { Variables: { member: MemberRow } };

export function bearerToken(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function sessionAuth(deps: Deps, getClientIp: GetClientIp): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    const member = token ? await resolveSession(deps.db, token, 'cli') : null;
    if (!member) {
      await enforceRateLimit(deps, c, `authfail:ip:${getClientIp(c)}`, FAILED_AUTH_LIMIT);
      throw new DomainError('unauthorized', 'missing or invalid session');
    }
    c.set('member', member);
    c.set('rateLimitSubject', { key: `member:${member.id}`, limit: SESSION_LIMIT });
    await next();
  };
}
