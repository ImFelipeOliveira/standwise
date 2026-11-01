import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
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

  test('the repository changelogs cover the package version', async () => {
    expect(await checkChangelogVersions(join(import.meta.dir, '../../..'))).toEqual([]);
  });
});
