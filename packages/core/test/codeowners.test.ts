import { describe, expect, test } from 'bun:test';
import { ownersForFiles, parseCodeowners } from '../src/codeowners';

describe('codeowners', () => {
  test('parses rules, skipping comments and blanks', () => {
    const rules = parseCodeowners('# c\n\n* @alice\n/docs/ @bob # trailing\n*.ts @acme/backend\n');
    expect(rules).toEqual([
      { pattern: '*', owners: ['@alice'] },
      { pattern: '/docs/', owners: ['@bob'] },
      { pattern: '*.ts', owners: ['@acme/backend'] },
    ]);
  });

  test('drops email owners but keeps rules left without owners', () => {
    const rules = parseCodeowners('a.txt dev@acme.com @alice\nb.txt dev@acme.com\n');
    expect(rules).toEqual([
      { pattern: 'a.txt', owners: ['@alice'] },
      { pattern: 'b.txt', owners: [] },
    ]);
  });

  test('a rule without usable owners does not leak earlier owners', () => {
    const rules = parseCodeowners('* @alice\nsecret/ dev@acme.com\n');
    expect(ownersForFiles(rules, ['secret/x'])).toEqual([]);
    expect(ownersForFiles(rules, ['open/x'])).toEqual(['@alice']);
  });

  test('single star matches only direct children', () => {
    const rules = parseCodeowners('docs/* @docs\n');
    expect(ownersForFiles(rules, ['docs/a.md'])).toEqual(['@docs']);
    expect(ownersForFiles(rules, ['docs/a/b.md'])).toEqual([]);
  });

  test('trailing slash matches a directory and its contents only', () => {
    const rules = parseCodeowners('foo/ @d\n');
    expect(ownersForFiles(rules, ['foo'])).toEqual([]);
    expect(ownersForFiles(rules, ['foo/a'])).toEqual(['@d']);
    expect(ownersForFiles(rules, ['x/foo/a/b'])).toEqual(['@d']);
  });

  test('slashless patterns match at any depth and directories cover contents', () => {
    const rules = parseCodeowners('*.ts @ts\nfoo @f\n');
    expect(ownersForFiles(rules, ['a/b/c.ts'])).toEqual(['@ts']);
    expect(ownersForFiles(rules, ['foo'])).toEqual(['@f']);
    expect(ownersForFiles(rules, ['x/foo/y/z.md'])).toEqual(['@f']);
  });

  test('pathological patterns finish fast', () => {
    const rules = [{ pattern: '*a*a*a*a*a*a*a*a*a*a*b', owners: ['@x'] }];
    const path = 'a'.repeat(5000);
    const start = performance.now();
    expect(ownersForFiles(rules, [path])).toEqual([]);
    expect(performance.now() - start).toBeLessThan(100);
  });

  test('ignores patterns longer than 255 characters', () => {
    const rules = [{ pattern: 'a'.repeat(256), owners: ['@x'] }];
    expect(ownersForFiles(rules, ['a'.repeat(256)])).toEqual([]);
  });

  test('last matching rule wins', () => {
    const rules = parseCodeowners('* @alice\n*.ts @bob\n');
    expect(ownersForFiles(rules, ['src/a.ts'])).toEqual(['@bob']);
    expect(ownersForFiles(rules, ['README.md'])).toEqual(['@alice']);
  });

  test('anchored directories and nested globs', () => {
    const rules = parseCodeowners('/docs/ @docs\napps/**/x @apps\n*.ts @ts\n');
    expect(ownersForFiles(rules, ['docs/a/b.md'])).toEqual(['@docs']);
    expect(ownersForFiles(rules, ['pkg/docs/b.md'])).toEqual([]);
    expect(ownersForFiles(rules, ['apps/web/deep/x'])).toEqual(['@apps']);
    expect(ownersForFiles(rules, ['apps/x'])).toEqual(['@apps']);
    expect(ownersForFiles(rules, ['other/apps/web/x'])).toEqual([]);
    expect(ownersForFiles(rules, ['deep/dir/a.ts'])).toEqual(['@ts']);
  });

  test('deduplicates owners across files', () => {
    const rules = parseCodeowners('*.ts @alice @acme/backend\n*.md @alice\n');
    expect(ownersForFiles(rules, ['a.ts', 'b.ts', 'c.md'])).toEqual(['@alice', '@acme/backend']);
  });

  test('keeps owners as written', () => {
    const rules = parseCodeowners('* @alice @acme/backend\n');
    expect(ownersForFiles(rules, ['x'])).toEqual(['@alice', '@acme/backend']);
  });
});
