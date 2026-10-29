export class GitHubOAuthError extends Error {
  constructor(readonly code: string) {
    super(`github oauth exchange failed: ${code}`);
    this.name = 'GitHubOAuthError';
  }
}

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
  if (typeof body?.error === 'string') throw new GitHubOAuthError(body.error);
  if (response.status === 401) throw new GitHubOAuthError('unauthorized');
  if (!response.ok || typeof body?.access_token !== 'string' || body.access_token === '') {
    throw new Error(`github oauth exchange failed: ${response.status}`);
  }
  return body.access_token;
}
