import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { changelogVersionProblems, checkChangelogVersions } from '../../../scripts/check-docs';

describe('changelog version check', () => {
  test('accepts a heading for the current version', () => {
    expect(
      changelogVersionProblems('docs/site/changelog.md', '### 0.3.0 — 2026-11-01\n', '0.3.0'),
    ).toEqual([]);
    expect(
      changelogVersionProblems('docs/api/CHANGELOG.md', '## 0.3.0 — 2026-11-01\n', '0.3.0'),
    ).toEqual([]);
  });

  test('rejects a changelog that only has unreleased or older entries', () => {
    expect(
      changelogVersionProblems(
        'docs/site/changelog.md',
        '### Unreleased\n\n### 0.2.0 — 2026-10-31\n',
        '0.3.0',
      ),
    ).toHaveLength(1);
    expect(
      changelogVersionProblems('docs/api/CHANGELOG.md', '## 0.3.0.1 — x\n', '0.3.0'),
    ).toHaveLength(1);
  });

  test('rejects a heading without a date in the changelog format', () => {
    expect(
      changelogVersionProblems('docs/site/changelog.md', '### 0.3.0 — \n', '0.3.0'),
    ).toHaveLength(1);
    expect(
      changelogVersionProblems('docs/site/pt-BR/changelog.md', '### 0.3.0 — 2026-11-01\n', '0.3.0'),
    ).toHaveLength(1);
    expect(
      changelogVersionProblems('docs/site/pt-BR/changelog.md', '### 0.3.0 — 01/11/2026\n', '0.3.0'),
    ).toEqual([]);
  });

  test('rejects an impossible calendar date in either format', () => {
    expect(
      changelogVersionProblems('docs/site/changelog.md', '### 0.3.0 — 2026-02-30\n', '0.3.0'),
    ).toHaveLength(1);
    expect(
      changelogVersionProblems('docs/site/pt-BR/changelog.md', '### 0.3.0 — 31/02/2026\n', '0.3.0'),
    ).toHaveLength(1);
    expect(
      changelogVersionProblems('docs/api/CHANGELOG.md', '## 0.3.0 — 2026-13-01\n', '0.3.0'),
    ).toHaveLength(1);
    expect(
      changelogVersionProblems('docs/site/changelog.md', '### 0.3.0 — 2028-02-29\n', '0.3.0'),
    ).toEqual([]);
  });

  async function checkRepo(files: Record<string, string>): Promise<string[]> {
    const root = await mkdtemp(join(tmpdir(), 'standcast-changelog-'));
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const problems = await checkChangelogVersions(root);
    await rm(root, { recursive: true, force: true });
    return problems;
  }

  test('one outdated changelog fails the whole check', async () => {
    expect(
      await checkRepo({
        'package.json': JSON.stringify({ version: '1.2.3' }),
        'docs/site/changelog.md': '### 1.2.3 — 2026-11-01\n',
        'docs/site/pt-BR/changelog.md': '### 1.2.2 — 31/10/2026\n',
        'docs/api/CHANGELOG.md': '## 1.2.3 — 2026-11-01\n',
      }),
    ).toEqual([
      'docs/site/pt-BR/changelog.md: no "1.2.3 — <date>" heading for the current version',
    ]);
  });

  test('a missing changelog file fails the whole check', async () => {
    expect(
      await checkRepo({
        'package.json': JSON.stringify({ version: '1.2.3' }),
        'docs/site/changelog.md': '### 1.2.3 — 2026-11-01\n',
        'docs/api/CHANGELOG.md': '## 1.2.3 — 2026-11-01\n',
      }),
    ).toEqual(['docs/site/pt-BR/changelog.md: page not found']);
  });

  test('the repository changelogs cover the package version', async () => {
    expect(await checkChangelogVersions(join(import.meta.dir, '../../..'))).toEqual([]);
  });
});
