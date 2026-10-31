import { z } from 'zod';
import { LinearAuthError, LinearGraphqlError, LinearRateLimitError } from './errors';

export type LinearFetch = typeof fetch;

export type LinearClient = {
  query<T>(query: string, variables: Record<string, unknown>): Promise<T>;
};

export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

export const LINEAR_TIMEOUT_MS = 10_000;

const envelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        extensions: z
          .object({
            code: z.string().optional(),
            type: z.string().optional(),
            userPresentableMessage: z.string().optional(),
          })
          .loose()
          .optional(),
      }),
    )
    .optional(),
});

function retryAfter(res: Response, now: number): number | null {
  const header = res.headers.get('retry-after');
  if (header !== null) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  }
  const resets = ['x-ratelimit-requests-reset', 'x-ratelimit-complexity-reset']
    .map((name) => Number(res.headers.get(name)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (resets.length === 0) return null;
  return Math.max(0, Math.ceil((Math.max(...resets) - now) / 1000));
}

function graphqlMessage(code: string | null, type: string | null, message: string): string {
  const label = code ?? type;
  if (type === 'invalid input') return label ?? 'invalid input';
  const text = message.slice(0, 200);
  return label ? `${label}: ${text}` : text;
}

export function createLinearClient(
  accessToken: string,
  fetchImpl: LinearFetch = fetch,
  timeoutMs: number = LINEAR_TIMEOUT_MS,
): LinearClient {
  return {
    async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const res = await fetchImpl(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401) throw new LinearAuthError();
      if (res.status === 429) throw new LinearRateLimitError(retryAfter(res, Date.now()));
      const raw = await res.json().catch(() => null);
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) {
        if (!res.ok) throw new Error(`linear http ${res.status}`);
        throw new Error('linear invalid response');
      }
      const first = parsed.data.errors?.[0];
      if (first) {
        const code = first.extensions?.code ?? null;
        const type = first.extensions?.type ?? null;
        if (code === 'AUTHENTICATION_ERROR' || type === 'authentication error') {
          throw new LinearAuthError();
        }
        if (code === 'RATELIMITED' || type === 'ratelimited') {
          throw new LinearRateLimitError(retryAfter(res, Date.now()));
        }
        const message = first.message ?? 'graphql error';
        throw new LinearGraphqlError(
          code,
          graphqlMessage(code, type, message),
          message,
          first.extensions?.userPresentableMessage ?? null,
        );
      }
      if (!res.ok) throw new Error(`linear http ${res.status}`);
      return parsed.data.data as T;
    },
  };
}
