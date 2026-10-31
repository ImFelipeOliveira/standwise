export function httpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown };
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export class GitHubRateLimitError extends Error {
  readonly code = 'github_rate_limited';
  constructor(readonly retryAfterSeconds: number) {
    super(`GitHub rate limit, retry after ${retryAfterSeconds}s`);
    this.name = 'GitHubRateLimitError';
  }
}

function headersOf(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null || !('response' in error)) return {};
  const response = (error as { response?: { headers?: unknown } }).response;
  const headers = response?.headers;
  return typeof headers === 'object' && headers !== null
    ? (headers as Record<string, unknown>)
    : {};
}

export function rateLimitRetryAfter(error: unknown, now: number = Date.now()): number | null {
  const status = httpStatus(error);
  if (status !== 403 && status !== 429) return null;
  const headers = headersOf(error);
  const retryAfter = Number(headers['retry-after']);
  if (headers['retry-after'] !== undefined && Number.isFinite(retryAfter)) {
    return Math.max(0, Math.ceil(retryAfter));
  }
  const reset = Number(headers['x-ratelimit-reset']);
  const exhausted = String(headers['x-ratelimit-remaining']) === '0';
  if (headers['x-ratelimit-reset'] !== undefined && Number.isFinite(reset) && exhausted) {
    return Math.max(0, Math.ceil(reset - now / 1000));
  }
  return null;
}

export function asRateLimitError(error: unknown): unknown {
  const retryAfter = rateLimitRetryAfter(error);
  return retryAfter === null ? error : new GitHubRateLimitError(retryAfter);
}
