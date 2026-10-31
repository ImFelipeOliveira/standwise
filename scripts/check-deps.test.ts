import { describe, expect, test } from 'bun:test';
import { importedPackages, packageNameOf, undeclared } from './check-deps';

describe('check-deps', () => {
  test('resolves package names from specifiers', () => {
    expect(packageNameOf('drizzle-orm')).toBe('drizzle-orm');
    expect(packageNameOf('drizzle-orm/postgres-js')).toBe('drizzle-orm');
    expect(packageNameOf('@standwise/db')).toBe('@standwise/db');
    expect(packageNameOf('@hono/zod-openapi/sub')).toBe('@hono/zod-openapi');
    expect(packageNameOf('./local')).toBeNull();
    expect(packageNameOf('node:crypto')).toBeNull();
    expect(packageNameOf('crypto')).toBeNull();
    expect(packageNameOf('bun:test')).toBeNull();
  });

  test('finds static, type and dynamic imports and re-exports', () => {
    const source = [
      "import { sql } from 'drizzle-orm';",
      "import type { Db } from '@standwise/db';",
      "export { x } from 'hono/html';",
      "const m = await import('postgres');",
      "import { a } from './a';",
    ].join('\n');
    expect(importedPackages(source).sort()).toEqual([
      '@standwise/db',
      'drizzle-orm',
      'hono',
      'postgres',
    ]);
  });

  test('reports imports missing from dependencies', () => {
    expect(
      undeclared(['drizzle-orm', 'hono', '@standwise/api'], {
        name: '@standwise/api',
        dependencies: { hono: '^4' },
      }),
    ).toEqual(['drizzle-orm']);
  });
});
