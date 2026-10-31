import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headersFile, inlineScriptHashes, siteCsp, writeSiteHeaders } from './docs-headers';

const temp = await mkdtemp(join(tmpdir(), 'standwise-headers-'));

afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('inlineScriptHashes', () => {
  test('hashes inline scripts and skips external ones', () => {
    const html =
      '<script>a()</script><script src="/x.js"></script><script type="module">b()</script>';
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(2);
    for (const hash of hashes) expect(hash).toMatch(/^'sha256-[A-Za-z0-9+/=]+'$/);
  });
});

describe('siteCsp', () => {
  test('is self-only, forbids framing and allows the given hashes', () => {
    const csp = siteCsp(["'sha256-abc'"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' 'sha256-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:/);
  });
});

describe('headersFile', () => {
  test('every rule is a path followed by indented name: value lines', () => {
    const lines = headersFile(["'sha256-abc'"]).trimEnd().split('\n');
    expect(lines[0]).toBe('/*');
    for (const line of lines) {
      if (line.startsWith('/')) continue;
      expect(line).toMatch(/^ {2}[A-Za-z-]+: \S.*$/);
    }
  });
});

describe('writeSiteHeaders', () => {
  test('writes _headers with the union of every page inline script hash', async () => {
    const dir = join(temp, 'site');
    await mkdir(join(dir, 'pt-BR'), { recursive: true });
    await writeFile(join(dir, 'index.html'), '<script>a()</script>');
    await writeFile(join(dir, 'pt-BR/index.html'), '<script>a()</script><script>b()</script>');
    await writeSiteHeaders(dir);
    const text = await readFile(join(dir, '_headers'), 'utf8');
    for (const hash of [
      ...inlineScriptHashes('<script>a()</script>'),
      ...inlineScriptHashes('<script>b()</script>'),
    ]) {
      expect(text).toContain(hash);
    }
    expect(text.match(/sha256-/g)).toHaveLength(2);
  });
});
