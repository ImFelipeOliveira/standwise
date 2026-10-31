import { ChatDeliveryError } from '@standwise/slack';

const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

const MESSAGES: Record<string, string> = {
  not_in_channel: 'the bot is not in the channel',
  channel_not_found: 'the channel was not found',
  is_archived: 'the channel is archived',
  invalid_auth: 'the Slack connection is no longer valid',
  not_authed: 'the Slack connection is no longer valid',
  token_revoked: 'the Slack connection is no longer valid',
  account_inactive: 'the Slack connection is no longer valid',
  user_not_found: 'the Slack user was not found',
  user_disabled: 'the Slack user is deactivated',
  ratelimited: 'Slack rate limited the request',
  timeout: 'Slack did not answer in time',
  deadline_exceeded: 'the attempt ran past its deadline',
  request_failed: 'could not reach Slack',
  http_error: 'Slack returned an HTTP error',
  invalid_response: 'Slack returned an unexpected response',
};

export function describeDeliveryError(error: unknown): string {
  if (!(error instanceof ChatDeliveryError)) return 'internal_error: unexpected error';
  const code = SAFE_CODE.test(error.code) ? error.code : 'unknown_error';
  return `${code}: ${MESSAGES[code] ?? 'Slack rejected the message'}`;
}
