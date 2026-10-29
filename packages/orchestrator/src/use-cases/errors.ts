export type DomainErrorCode =
  | 'unauthorized'
  | 'invalid_request'
  | 'invalid_daily'
  | 'org_not_found'
  | 'org_not_configured'
  | 'not_in_team'
  | 'forbidden'
  | 'invalid_state'
  | 'installation_pending'
  | 'access_denied'
  | 'slack_oauth_failed'
  | 'rate_limited';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
