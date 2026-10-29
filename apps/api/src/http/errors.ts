import { DomainError, type DomainErrorCode } from '@standwise/orchestrator';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  invalid_request: 422,
  invalid_daily: 422,
  org_not_found: 404,
  org_not_configured: 409,
  not_in_team: 422,
};

export function onError(error: Error, c: Context): Response {
  if (error instanceof DomainError) {
    const { code, message, details } = error;
    return c.json(
      { error: { code, message, ...(details !== undefined ? { issues: details } : {}) } },
      STATUS[code],
    );
  }
  console.error(error);
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
}
