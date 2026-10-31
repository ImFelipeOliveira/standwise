import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const WORKSPACE_GLOBS = ['apps', 'packages', 'packages/adapters'];
const IMPORT_PATTERN =
  /(?:^|[\s;])(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;
const BUILTINS = new Set(builtinModules);

export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:') || specifier.startsWith('bun:') || specifier === 'bun')
    return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '');
  if (BUILTINS.has(name)) return null;
  return name;
}

export function importedPackages(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    const name = specifier ? packageNameOf(specifier) : null;
    if (name) names.add(name);
  }
  return [...names];
}

export function undeclared(
  imported: string[],
  manifest: {
    name?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  },
): string[] {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  return imported.filter((name) => name !== manifest.name && !declared.has(name)).sort();
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function workspaceDirs(root: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const glob of WORKSPACE_GLOBS) {
    const entries = await readdir(join(root, glob), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, glob, entry.name);
      const hasManifest = await readFile(join(dir, 'package.json'), 'utf8').then(
        () => true,
        () => false,
      );
      if (hasManifest) dirs.push(dir);
    }
  }
  return dirs;
}

export async function checkDeps(root: string): Promise<string[]> {
  const errors: string[] = [];
  for (const dir of await workspaceDirs(root)) {
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const imported = new Set<string>();
    for (const file of await sourceFiles(join(dir, 'src'))) {
      for (const name of importedPackages(await readFile(file, 'utf8'))) imported.add(name);
    }
    for (const name of undeclared([...imported], manifest)) {
      errors.push(
        `${manifest.name ?? dir}: imports ${name} but does not declare it in dependencies`,
      );
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = await checkDeps(process.cwd());
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log('deps: all checks passed');
}
