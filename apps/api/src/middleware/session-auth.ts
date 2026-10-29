import { type MemberRow, resolveSession } from '@standwise/db';
import { type Deps, DomainError } from '@standwise/orchestrator';
import type { MiddlewareHandler } from 'hono';
import {
  assertNotLockedOut,
  enforceRateLimit,
  FAILED_AUTH_LIMIT,
  type GetClientIp,
  type RateLimitEnv,
  SESSION_LIMIT,
} from './rate-limit';

export type SessionEnv = RateLimitEnv & { Variables: { member: MemberRow } };

function bearerToken(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function sessionAuth(deps: Deps, getClientIp: GetClientIp): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const failedKey = `authfail:ip:${getClientIp(c)}`;
    await assertNotLockedOut(deps, c, failedKey, FAILED_AUTH_LIMIT);
    const token = bearerToken(c.req.header('authorization'));
    const member = token ? await resolveSession(deps.db, token, 'cli') : null;
    if (!member) {
      await enforceRateLimit(deps, c, failedKey, FAILED_AUTH_LIMIT);
      throw new DomainError('unauthorized', 'missing or invalid session');
    }
    c.set('member', member);
    c.set('rateLimitSubject', { key: `member:${member.id}`, limit: SESSION_LIMIT });
    await next();
  };
}
