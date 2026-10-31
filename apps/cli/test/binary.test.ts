import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CLI_COMPILE_FLAGS } from '../../../scripts/cli-compile-flags';

const enabled = process.env.STANDWISE_BINARY_TESTS === '1';

describe.skipIf(!enabled)('compiled binary', () => {
  test('does not autoload bunfig.toml or .env from the working directory', async () => {
    const out = await mkdtemp(join(tmpdir(), 'standwise-bin-'));
    const cwd = await mkdtemp(join(tmpdir(), 'standwise-cwd-'));
    const binary = join(out, 'standwise');
    const build = Bun.spawnSync(
      [
        'bun',
        'build',
        ...CLI_COMPILE_FLAGS,
        resolve(import.meta.dir, '../src/main.ts'),
        '--outfile',
        binary,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(build.exitCode).toBe(0);
    const marker = join(cwd, 'ran');
    await writeFile(join(cwd, 'p.ts'), `await Bun.write(${JSON.stringify(marker)}, 'x');\n`);
    await writeFile(join(cwd, 'bunfig.toml'), 'preload = ["./p.ts"]\n');
    await writeFile(join(cwd, '.env'), 'STANDWISE_LANG=pt-BR\n');
    const run = Bun.spawnSync([binary, '--help'], {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: cwd },
      stdout: 'pipe',
    });
    expect(run.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(run.stdout.toString()).toContain('Usage: standwise');
  });
});
