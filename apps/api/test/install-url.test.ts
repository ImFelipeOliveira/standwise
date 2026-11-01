import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  checkInstallUrl,
  installUrlProblems,
  PUBLISHED_INSTALL_URL,
} from '../../../scripts/check-docs';

const CANONICAL = 'curl -fsSL https://api.standcast.app/install.sh | sh';

describe('install url check', () => {
  test('accepts the canonical url', () => {
    expect(installUrlProblems('a.md', CANONICAL)).toEqual([]);
  });

  test('rejects other hosts and the placeholder', () => {
    expect(installUrlProblems('a.md', 'https://standcast.app/install.sh')).toHaveLength(1);
    expect(
      installUrlProblems('a.md', 'https://<standcast-host>/install.sh').length,
    ).toBeGreaterThan(0);
  });

  test('files read outside the docs build use the published url', () => {
    const published = `curl -fsSL ${PUBLISHED_INSTALL_URL} | sh`;
    expect(installUrlProblems('README.md', published, PUBLISHED_INSTALL_URL)).toEqual([]);
    expect(installUrlProblems('README.md', CANONICAL, PUBLISHED_INSTALL_URL)).toHaveLength(1);
    expect(installUrlProblems('a.md', published)).toHaveLength(1);
  });

  test('the repository uses only the expected urls', async () => {
    expect(await checkInstallUrl(join(import.meta.dir, '../../..'))).toEqual([]);
  });
});
