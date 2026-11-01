import { describe, expect, test } from 'bun:test';
import { csrfToken, verifyCsrf } from '../src';

describe('csrf token', () => {
  test('is stable per session and secret, and differs across sessions and secrets', () => {
    const token = csrfToken('secret-secret-secret', 'sc_session-a');
    expect(csrfToken('secret-secret-secret', 'sc_session-a')).toBe(token);
    expect(csrfToken('secret-secret-secret', 'sc_session-b')).not.toBe(token);
    expect(csrfToken('other-secret-secret!', 'sc_session-a')).not.toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('does not contain the session token or its hash', () => {
    const token = csrfToken('secret-secret-secret', 'sc_session-a');
    expect(token).not.toContain('session-a');
  });

  test('verifies only the token of the same session and secret', () => {
    const secret = 'secret-secret-secret';
    const token = csrfToken(secret, 'sc_session-a');
    expect(verifyCsrf(secret, 'sc_session-a', token)).toBe(true);
    expect(verifyCsrf(secret, 'sc_session-b', token)).toBe(false);
    expect(verifyCsrf('other-secret-secret!', 'sc_session-a', token)).toBe(false);
    expect(verifyCsrf(secret, 'sc_session-a', undefined)).toBe(false);
    expect(verifyCsrf(secret, 'sc_session-a', '')).toBe(false);
    expect(verifyCsrf(secret, 'sc_session-a', ['x'])).toBe(false);
    expect(verifyCsrf(secret, 'sc_session-a', `${token}x`)).toBe(false);
  });
});
