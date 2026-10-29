import { type MemberRow, resolveSession } from '@standwise/db';
import { type Deps, DomainError } from '@standwise/orchestrator';
import type { MiddlewareHandler } from 'hono';
import { bearerToken } from './rate-limit';

export type SessionEnv = { Variables: { member: MemberRow } };

export function sessionAuth(deps: Deps): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const token = bearerToken(c);
    const member = token ? await resolveSession(deps.db, token, 'cli') : null;
    if (!member) throw new DomainError('unauthorized', 'missing or invalid session');
    c.set('member', member);
    await next();
  };
}
