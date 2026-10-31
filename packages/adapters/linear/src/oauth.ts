import { z } from 'zod';
import type { LinearFetch } from './client';

export type LinearTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

const TOKEN_URL = 'https://api.linear.app/oauth/token';

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().nullish(),
  expires_in: z.number().positive().nullish(),
});

export function linearAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL('https://linear.app/oauth/authorize');
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'read');
  u.searchParams.set('actor', 'app');
  u.searchParams.set('state', input.state);
  return u.toString();
}

async function requestTokens(body: URLSearchParams, fetchImpl: LinearFetch): Promise<LinearTokens> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`linear oauth http ${res.status}`);
  const parsed = tokenResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error('linear oauth invalid response');
  const { access_token, refresh_token, expires_in } = parsed.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token ?? null,
    expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
  };
}

export function exchangeLinearCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: LinearFetch = fetch,
): Promise<LinearTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    }),
    fetchImpl,
  );
}

export function refreshLinearToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: LinearFetch = fetch,
): Promise<LinearTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    }),
    fetchImpl,
  );
}
