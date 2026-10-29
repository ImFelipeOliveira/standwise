export function githubAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }) {
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('state', p.state);
  return u.toString();
}

export async function exchangeWebCode(
  p: { clientId: string; clientSecret: string; code: string },
  opts: { fetch?: typeof fetch } = {},
): Promise<string> {
  const doFetch = opts.fetch ?? fetch;
  const response = await doFetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code: p.code,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof body?.access_token !== 'string' || body.access_token === '') {
    throw new Error(`github oauth exchange failed: ${String(body?.error ?? response.status)}`);
  }
  return body.access_token;
}
