import { type ApiKeyScope, resolveApiKey } from '@standcast/db';
import { type Deps, DomainError } from '@standcast/orchestrator';
import type { MiddlewareHandler } from 'hono';
import {
  API_KEY_LIMIT,
  enforceRateLimit,
  FAILED_AUTH_LIMIT,
  type GetClientIp,
  type RateLimitEnv,
  subjectRateLimit,
} from './rate-limit';
import { bearerToken } from './session-auth';

export type ApiKeyContext = { id: string; installationId: number; scopes: ApiKeyScope[] };

export type ApiKeyEnv = { Variables: RateLimitEnv['Variables'] & { apiKey: ApiKeyContext } };

export function apiKeyAuth(deps: Deps, getClientIp: GetClientIp): MiddlewareHandler<ApiKeyEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    const apiKey = token ? await resolveApiKey(deps.db, token) : null;
    if (!apiKey) {
      await enforceRateLimit(deps, c, `authfail:ip:${getClientIp(c)}`, FAILED_AUTH_LIMIT);
      throw new DomainError('unauthorized', 'missing or invalid api key');
    }
    c.set('apiKey', apiKey);
    c.set('rateLimitSubject', { key: `apikey:${apiKey.id}`, limit: API_KEY_LIMIT });
    await next();
  };
}

export function requireScope(scope: ApiKeyScope): MiddlewareHandler<ApiKeyEnv> {
  return async (c, next) => {
    if (!c.get('apiKey').scopes.includes(scope)) {
      throw new DomainError('insufficient_scope', `api key lacks the ${scope} scope`, undefined, {
        required_scope: scope,
      });
    }
    await next();
  };
}

export function apiKeyChain(
  deps: Deps,
  getClientIp: GetClientIp,
  scope: ApiKeyScope,
): MiddlewareHandler<ApiKeyEnv>[] {
  return [apiKeyAuth(deps, getClientIp), subjectRateLimit<ApiKeyEnv>(deps), requireScope(scope)];
}
