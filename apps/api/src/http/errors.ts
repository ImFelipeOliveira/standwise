import { DomainError, type DomainErrorCode, logError } from '@standwise/orchestrator';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  invalid_request: 422,
  invalid_daily: 422,
  org_not_found: 404,
  org_not_configured: 409,
  not_in_team: 422,
  forbidden: 403,
  invalid_state: 400,
  installation_pending: 409,
  access_denied: 403,
  slack_oauth_failed: 502,
  linear_oauth_failed: 502,
  rate_limited: 429,
  insufficient_scope: 403,
  not_found: 404,
  suggestion_already_decided: 409,
  invalid_beta_request: 422,
};

export function onError(error: Error, c: Context): Response {
  if (error instanceof DomainError) {
    const { code, message, details, fields } = error;
    return c.json(
      {
        error: {
          code,
          message,
          ...(details !== undefined ? { issues: details } : {}),
          ...fields,
        },
      },
      STATUS[code],
    );
  }
  logError('unhandled api error', error);
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
}
