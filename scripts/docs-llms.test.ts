import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
let outDir = '';

const read = (path: string) => readFile(join(outDir, path), 'utf8');
const exists = (path: string) =>
  stat(join(outDir, path)).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  outDir = join(await mkdtemp(join(tmpdir(), 'standwise-llms-')), 'dist');
  const build = Bun.spawnSync(['bun', 'run', 'docs:build', '--outDir', outDir], {
    cwd: ROOT,
    env: { ...process.env, SUPPORT_EMAIL: 'test@example.com' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString() + build.stdout.toString());
}, 120_000);

describe('docs llms files', () => {
  test('english llms.txt lists the english pages and points at the portuguese one', async () => {
    const text = await read('llms.txt');
    expect(text.startsWith('# Standwise')).toBe(true);
    expect(text).toContain('/admin/configuration.md');
    expect(text).toContain('/pt-BR/llms.txt');
  });

  test('english llms-full.txt carries english pages only', async () => {
    const text = await read('llms-full.txt');
    expect(text).toContain('remind_at');
    expect(text).toContain('digest_at');
    expect(text).not.toContain('Visão geral da API');
  });

  test('portuguese pair is published under pt-BR', async () => {
    expect(await read('pt-BR/llms.txt')).toContain('/pt-BR/admin/configuration.md');
    expect(await read('pt-BR/llms-full.txt')).toContain('Visão geral da API');
  });

  test('every page has a markdown twin in both languages', async () => {
    expect(await exists('admin/configuration.md')).toBe(true);
    expect(await exists('pt-BR/admin/configuration.md')).toBe(true);
  });
});
