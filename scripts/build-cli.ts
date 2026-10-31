import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { CLI_COMPILE_FLAGS, cliDefineFlags } from './cli-compile-flags';

const targets = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-windows-x64',
];

const defineFlags = cliDefineFlags(process.env);

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const sums: string[] = [];
for (const target of targets) {
  const name = `standwise-${target}${target.includes('windows') ? '.exe' : ''}`;
  const outfile = `dist/${name}`;
  const proc = Bun.spawn(
    [
      'bun',
      'build',
      ...CLI_COMPILE_FLAGS,
      ...defineFlags,
      `--target=${target}`,
      'apps/cli/src/main.ts',
      '--outfile',
      outfile,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if ((await proc.exited) !== 0) process.exit(1);
  const hash = createHash('sha256')
    .update(await readFile(outfile))
    .digest('hex');
  sums.push(`${hash}  ${name}`);
}

await writeFile('dist/SHA256SUMS', `${sums.join('\n')}\n`);
