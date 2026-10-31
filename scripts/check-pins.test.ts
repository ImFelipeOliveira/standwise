import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkCompose, checkDockerfile, checkRepo, checkWorkflow } from './check-pins';

const SHA = '11d5960a326750d5838078e36cf38b85af677262';
const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('checkWorkflow', () => {
  test('accepts actions pinned to a full sha', () => {
    const text = `steps:\n  - name: checkout v4\n    uses: actions/checkout@${SHA}\n  - id: x\n    uses: a/b@${SHA}\n`;
    expect(checkWorkflow(text)).toEqual([]);
  });

  test('rejects tags, branches and short shas', () => {
    const text = `steps:\n  - uses: actions/checkout@v4\n  - uses: a/b@main\n  - uses: c/d@11d5960\n  - uses: e/f\n`;
    expect(checkWorkflow(text)).toHaveLength(4);
  });

  test('ignores local actions', () => {
    expect(checkWorkflow('steps:\n  - uses: ./.github/actions/x\n')).toEqual([]);
  });
});

describe('checkDockerfile', () => {
  test('accepts digest-pinned images and stage references', () => {
    const text = `FROM oven/bun:1@${DIGEST} AS deps\nFROM deps AS build\nCOPY --from=node:22@${DIGEST} /a /b\nCOPY --from=build /x /y\n`;
    expect(checkDockerfile(text)).toEqual([]);
  });

  test('rejects images without a digest', () => {
    const text = 'FROM oven/bun:1 AS deps\nFROM node\nCOPY --from=node:22-slim /a /b\n';
    expect(checkDockerfile(text)).toHaveLength(3);
  });
});

describe('checkCompose', () => {
  test('flags unpinned images only', () => {
    expect(checkCompose(`image: postgres:17@${DIGEST}\n`)).toEqual([]);
    expect(checkCompose('image: postgres:17\n')).toHaveLength(1);
  });
});

describe('repository', () => {
  test('has every action and image pinned', async () => {
    expect(await checkRepo(join(import.meta.dir, '..'))).toEqual([]);
  });
});
