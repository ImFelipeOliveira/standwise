import { describe, expect, test } from 'bun:test';
import { stripUnsafeChars } from '@standwise/core';
import { browserCommand } from '../src/device-flow';

describe('browserCommand', () => {
  test('picks the opener per platform', () => {
    expect(browserCommand('darwin', 'https://x')).toEqual(['open', 'https://x']);
    expect(browserCommand('linux', 'https://x')).toEqual(['xdg-open', 'https://x']);
    expect(browserCommand('win32', 'https://x')).toEqual([
      'rundll32',
      'url.dll,FileProtocolHandler',
      'https://x',
    ]);
  });
});

describe('stripUnsafeChars', () => {
  test('removes control and bidi characters', () => {
    expect(stripUnsafeChars('a\u001bb\u007fc\u202ed\u2066e\u2069f\u202a')).toBe('abcdef');
  });
});
