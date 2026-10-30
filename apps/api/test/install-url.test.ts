import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkInstallUrl, installUrlProblems } from '../../../scripts/check-docs';

const CANONICAL = 'curl -fsSL https://api.standwise.dev/install.sh | sh';

describe('install url check', () => {
  test('accepts the canonical url', () => {
    expect(installUrlProblems('a.md', CANONICAL)).toEqual([]);
  });

  test('rejects other hosts and the placeholder', () => {
    expect(installUrlProblems('a.md', 'https://standwise.dev/install.sh')).toHaveLength(1);
    expect(
      installUrlProblems('a.md', 'https://<standwise-host>/install.sh').length,
    ).toBeGreaterThan(0);
  });

  test('the repository uses only the canonical url', async () => {
    expect(await checkInstallUrl(join(import.meta.dir, '../../..'))).toEqual([]);
  });
});
