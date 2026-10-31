import { describe, expect, test } from 'bun:test';
import { cliDefineFlags, resolveDefaultApiUrl } from './cli-compile-flags';

describe('resolveDefaultApiUrl', () => {
  test('defaults to the canonical api', () => {
    expect(resolveDefaultApiUrl({})).toBe('https://api.standwise.dev');
    expect(resolveDefaultApiUrl({ STANDWISE_DEFAULT_API_URL: '' })).toBe(
      'https://api.standwise.dev',
    );
  });

  test('accepts an https url and trims trailing slashes', () => {
    expect(resolveDefaultApiUrl({ STANDWISE_DEFAULT_API_URL: 'https://x.example.com/' })).toBe(
      'https://x.example.com',
    );
  });

  test('rejects non-https and invalid values', () => {
    expect(() =>
      resolveDefaultApiUrl({ STANDWISE_DEFAULT_API_URL: 'http://x.example.com' }),
    ).toThrow();
    expect(() => resolveDefaultApiUrl({ STANDWISE_DEFAULT_API_URL: 'not a url' })).toThrow();
  });

  test('builds a define flag with a quoted literal', () => {
    expect(cliDefineFlags({ STANDWISE_DEFAULT_API_URL: 'https://x.example.com' })).toEqual([
      '--define',
      'STANDWISE_DEFAULT_API_URL="https://x.example.com"',
    ]);
  });
});
