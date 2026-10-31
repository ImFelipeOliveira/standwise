import { describe, expect, test } from 'bun:test';
import { ChatDeliveryError } from '@standwise/slack';
import { describeDeliveryError } from '../../src/use-cases/delivery-error';

describe('describeDeliveryError', () => {
  test('a known chat error keeps its code with a safe message', () => {
    const error = new ChatDeliveryError('not_in_channel', 'raw <b>slack</b> text xoxb-123');
    expect(describeDeliveryError(error)).toBe('not_in_channel: the bot is not in the channel');
  });

  test('a stale slack user keeps its code with a safe message', () => {
    expect(describeDeliveryError(new ChatDeliveryError('user_not_found', 'raw U123'))).toBe(
      'user_not_found: the Slack user was not found',
    );
    expect(describeDeliveryError(new ChatDeliveryError('user_disabled', 'raw U123'))).toBe(
      'user_disabled: the Slack user is deactivated',
    );
  });

  test('an unknown chat error code keeps the code with a generic message', () => {
    expect(describeDeliveryError(new ChatDeliveryError('msg_too_long', 'raw details'))).toBe(
      'msg_too_long: Slack rejected the message',
    );
  });

  test('a malformed code becomes unknown_error', () => {
    const error = new ChatDeliveryError('<script>alert(1)</script>', 'raw');
    expect(describeDeliveryError(error)).toBe('unknown_error: Slack rejected the message');
  });

  test('an internal error never stores its raw text', () => {
    const error = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    const described = describeDeliveryError(error);
    expect(described).toBe('internal_error: unexpected error');
    expect(describeDeliveryError('boom')).toBe('internal_error: unexpected error');
  });
});
