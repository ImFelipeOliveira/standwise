export class LinearAuthError extends Error {
  constructor(message = 'linear authentication failed') {
    super(message);
    this.name = 'LinearAuthError';
  }
}

export class LinearRateLimitError extends Error {
  constructor(
    public retryAfterSeconds: number | null,
    message = 'linear rate limited',
  ) {
    super(message);
    this.name = 'LinearRateLimitError';
  }
}

export class LinearGraphqlError extends Error {
  constructor(
    public code: string | null,
    message: string,
  ) {
    super(code ? `${code}: ${message}` : message);
    this.name = 'LinearGraphqlError';
  }
}
