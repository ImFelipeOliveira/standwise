import { describe, expect, test } from 'bun:test';
import { DEFAULT_API_URL } from '../src/api';
import { FALLBACK_API_URL, resolveDefaultApiUrl } from '../src/default-api-url';

describe('default api url', () => {
  test('falls back when no build-time value is injected', () => {
    expect(DEFAULT_API_URL).toBe('https://api.standwise.dev');
    expect(resolveDefaultApiUrl(undefined)).toBe(FALLBACK_API_URL);
    expect(resolveDefaultApiUrl('')).toBe(FALLBACK_API_URL);
  });

  test('uses an injected value', () => {
    expect(resolveDefaultApiUrl('https://x.example.com')).toBe('https://x.example.com');
  });
});
