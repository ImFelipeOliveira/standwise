import { describe, expect, test } from 'bun:test';
import { signState, verifyState } from '../src/state-token';
import { sanitizeNext } from '../src/use-cases/start-web-login';

const NOW = new Date('2026-10-28T15:00:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('state token', () => {
  test('round-trips within ten minutes', () => {
    const token = signState('s', { kind: 'login', next: '/setup' }, NOW);
    expect(verifyState('s', token, 'login', later(9))).toMatchObject({
      kind: 'login',
      next: '/setup',
    });
  });

  test('expires after ten minutes', () => {
    const token = signState('s', { kind: 'login', next: '/' }, NOW);
    expect(verifyState('s', token, 'login', later(11))).toBeNull();
  });

  test('rejects another secret, another kind and malformed input', () => {
    const token = signState('s', { kind: 'login', next: '/' }, NOW);
    expect(verifyState('other', token, 'login', NOW)).toBeNull();
    expect(verifyState('s', token, 'slack', NOW)).toBeNull();
    expect(verifyState('s', 'garbage', 'login', NOW)).toBeNull();
    expect(verifyState('s', `${token}.x`, 'login', NOW)).toBeNull();
  });
});

describe('sanitizeNext', () => {
  test('keeps only same-origin relative paths', () => {
    expect(sanitizeNext('/setup?installation_id=1')).toBe('/setup?installation_id=1');
    for (const bad of [undefined, '', 'https://x.com', '//x.com', '/\\x.com', 'x', '/\n/x.com']) {
      expect(sanitizeNext(bad)).toBe('/');
    }
  });
});
