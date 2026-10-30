import { describe, expect, test } from 'bun:test';
import { parsePullRequestUrl } from '../src/github-ref';

describe('parsePullRequestUrl', () => {
  test('parses a pull request url', () => {
    expect(parsePullRequestUrl('https://github.com/acme/api/pull/412')).toEqual({
      owner: 'acme',
      repo: 'api',
      number: 412,
    });
  });

  test('accepts files path, hash and query', () => {
    for (const u of [
      'https://github.com/acme/api/pull/412/files',
      'https://github.com/acme/api/pull/412#issuecomment-1',
      'https://github.com/acme/api/pull/412?diff=split',
      'https://github.com/acme/api/pull/412/',
    ]) {
      expect(parsePullRequestUrl(u)).toEqual({ owner: 'acme', repo: 'api', number: 412 });
    }
  });

  test('rejects everything else', () => {
    for (const u of [
      'http://github.com/acme/api/pull/412',
      'https://gitlab.com/acme/api/pull/412',
      'https://github.com/acme/api/issues/1',
      'https://github.com/acme/api/pull/abc',
      'https://github.com/acme/api/pull/0',
      'https://github.com/acme/api/pull/12abc',
      'not a url',
    ]) {
      expect(parsePullRequestUrl(u)).toBeNull();
    }
  });
});
