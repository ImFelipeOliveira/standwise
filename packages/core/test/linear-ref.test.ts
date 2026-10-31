import { describe, expect, test } from 'bun:test';
import { parseLinearIssueUrl } from '../src/linear-ref';

describe('parseLinearIssueUrl', () => {
  test('parses an issue url with slug', () => {
    expect(parseLinearIssueUrl('https://linear.app/acme/issue/BE-123/fix-login')).toEqual({
      workspace: 'acme',
      identifier: 'BE-123',
    });
  });

  test('accepts no slug, hash, query and trailing slash', () => {
    for (const u of [
      'https://linear.app/acme/issue/BE-123',
      'https://linear.app/acme/issue/BE-123/',
      'https://linear.app/acme/issue/BE-123/fix-login#comment-abc',
      'https://linear.app/acme/issue/BE-123?foo=1',
      'https://linear.app/acme/issue/BE-123#comment-abc',
    ]) {
      expect(parseLinearIssueUrl(u)).toEqual({ workspace: 'acme', identifier: 'BE-123' });
    }
  });

  test('uppercases the identifier', () => {
    expect(parseLinearIssueUrl('https://linear.app/acme/issue/be-7/x')?.identifier).toBe('BE-7');
  });

  test('rejects everything else', () => {
    for (const u of [
      'http://linear.app/acme/issue/BE-123',
      'https://example.com/acme/issue/BE-123',
      'https://linear.app/acme/project/BE-123',
      'https://linear.app/acme/issue/BE',
      'https://linear.app/acme/issue/BE-abc',
      'not a url',
    ]) {
      expect(parseLinearIssueUrl(u)).toBeNull();
    }
  });
});
