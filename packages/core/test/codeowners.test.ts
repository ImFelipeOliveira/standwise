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

  test('drops email owners and rules left without owners', () => {
    const rules = parseCodeowners('a.txt dev@acme.com @alice\nb.txt dev@acme.com\n');
    expect(rules).toEqual([{ pattern: 'a.txt', owners: ['@alice'] }]);
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
