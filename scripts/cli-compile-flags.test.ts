import { describe, expect, test } from 'bun:test';
import { resolveDefaultApiUrl } from '../apps/cli/src/default-api-url';
import { cliDefineFlags } from './cli-compile-flags';

describe('resolveDefaultApiUrl', () => {
  test('defaults to the canonical api', () => {
    expect(resolveDefaultApiUrl(undefined)).toBe('https://api.standwise.dev');
    expect(resolveDefaultApiUrl('')).toBe('https://api.standwise.dev');
  });

  test('accepts an https url and trims trailing slashes', () => {
    expect(resolveDefaultApiUrl('https://x.example.com/')).toBe('https://x.example.com');
  });

  test('rejects non-https and invalid values', () => {
    expect(() => resolveDefaultApiUrl('http://x.example.com')).toThrow();
    expect(() => resolveDefaultApiUrl('not a url')).toThrow();
  });

  test('builds a define flag with a quoted literal', () => {
    expect(cliDefineFlags({ STANDWISE_DEFAULT_API_URL: 'https://x.example.com' })).toEqual([
      '--define',
      'STANDWISE_DEFAULT_API_URL="https://x.example.com"',
    ]);
  });
});
