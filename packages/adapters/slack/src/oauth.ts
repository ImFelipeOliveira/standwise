import { createWebClient } from './channel';
import { mapSlackErrors } from './errors';

export const SLACK_SCOPES = [
  'chat:write',
  'chat:write.public',
  'im:write',
  'users:read',
  'users:read.email',
  'channels:read',
  'groups:read',
] as const;

export function slackAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL('https://slack.com/oauth/v2/authorize');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('scope', SLACK_SCOPES.join(','));
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('state', p.state);
  return u.toString();
}

export async function exchangeSlackCode(p: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  slackApiUrl?: string;
}): Promise<{ teamId: string; botToken: string }> {
  const client = createWebClient(undefined, p.slackApiUrl);
  const res = await mapSlackErrors(() =>
    client.oauth.v2.access({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code: p.code,
      redirect_uri: p.redirectUri,
    }),
  );
  return { teamId: res.team?.id ?? '', botToken: res.access_token ?? '' };
}
