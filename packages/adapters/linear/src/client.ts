import { z } from 'zod';
import { LinearAuthError, LinearGraphqlError, LinearRateLimitError } from './errors';

export type LinearFetch = typeof fetch;

export type LinearClient = {
  query<T>(query: string, variables: Record<string, unknown>): Promise<T>;
};

export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

const envelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        extensions: z.object({ code: z.string().optional() }).loose().optional(),
      }),
    )
    .optional(),
});

function retryAfter(res: Response, now: number): number | null {
  const reset = Number(res.headers.get('x-ratelimit-requests-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, Math.ceil((reset - now) / 1000));
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header >= 0 && res.headers.get('retry-after') !== null) {
    return Math.ceil(header);
  }
  return null;
}

export function createLinearClient(
  accessToken: string,
  fetchImpl: LinearFetch = fetch,
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
        if (code === 'AUTHENTICATION_ERROR') throw new LinearAuthError();
        if (code === 'RATELIMITED') throw new LinearRateLimitError(retryAfter(res, Date.now()));
        throw new LinearGraphqlError(code, first.message ?? 'graphql error');
      }
      if (!res.ok) throw new Error(`linear http ${res.status}`);
      return parsed.data.data as T;
    },
  };
}
