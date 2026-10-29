import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseConfig } from '../packages/core/src/config';

const PT_BR = 'pt-BR';
const CONFIG_PAGE = 'admin/configuration.md';
const OVERVIEW_PAGE = 'index.md';
const IGNORED_DIRS = new Set(['.vitepress', 'public', 'node_modules']);

const OVERVIEW_SECTIONS: Record<string, string[]> = {
  [OVERVIEW_PAGE]: ['What it is', 'Who it is for', 'How it works', 'What Standwise does not do'],
  [`${PT_BR}/${OVERVIEW_PAGE}`]: [
    'O que é',
    'Para quem é',
    'Como funciona',
    'O que o Standwise não faz',
  ],
};

async function listPages(siteDir: string): Promise<string[]> {
  const entries = await readdir(siteDir, { recursive: true });
  return entries
    .map((entry) => entry.split('\\').join('/'))
    .filter((entry) => entry.endsWith('.md'))
    .filter((entry) => !entry.split('/').some((part) => IGNORED_DIRS.has(part)))
    .sort();
}

async function readPage(siteDir: string, page: string): Promise<string | null> {
  try {
    return await readFile(join(siteDir, page), 'utf8');
  } catch {
    return null;
  }
}

export function yamlBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```ya?ml[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1] ?? '');
}

export async function checkConfigExamples(siteDir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const page of [CONFIG_PAGE, `${PT_BR}/${CONFIG_PAGE}`]) {
    const markdown = await readPage(siteDir, page);
    if (markdown === null) {
      problems.push(`${page}: page not found`);
      continue;
    }
    const blocks = yamlBlocks(markdown);
    if (blocks.length === 0) problems.push(`${page}: no yaml examples found`);
    blocks.forEach((block, index) => {
      const result = parseConfig(block);
      if (result.ok) return;
      const errors = result.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
      problems.push(`${page}: yaml block ${index + 1} is invalid: ${errors}`);
    });
  }
  return problems;
}

export async function checkParity(siteDir: string): Promise<string[]> {
  const pages = await listPages(siteDir);
  const prefix = `${PT_BR}/`;
  const english = new Set(pages.filter((p) => !p.startsWith(prefix)));
  const portuguese = new Set(pages.filter((p) => p.startsWith(prefix)).map((p) => p.slice(6)));
  const problems = [
    ...[...english].filter((p) => !portuguese.has(p)).map((p) => `${p}: missing in pt-BR`),
    ...[...portuguese].filter((p) => !english.has(p)).map((p) => `${p}: missing in English`),
  ];
  return problems.sort();
}

export async function checkOverview(siteDir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const [page, sections] of Object.entries(OVERVIEW_SECTIONS)) {
    const markdown = await readPage(siteDir, page);
    if (markdown === null) {
      problems.push(`${page}: page not found`);
      continue;
    }
    const headings = new Set(
      markdown
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3).trim()),
    );
    for (const section of sections) {
      if (!headings.has(section)) problems.push(`${page}: missing section "${section}"`);
    }
  }
  return problems;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function checkIncludes(siteDir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const page of await listPages(siteDir)) {
    const markdown = (await readPage(siteDir, page)) ?? '';
    for (const match of markdown.matchAll(/<!--\s*@include:\s*(.*?)\s*-->/g)) {
      const target = (match[1] ?? '').replace(/(#[\w-]+)?(\{\d*,\d*\})?$/, '');
      const path = target.startsWith('@')
        ? join(siteDir, target.slice(target[1] === '/' ? 2 : 1))
        : join(dirname(join(siteDir, page)), target);
      if (!(await exists(path))) problems.push(`${page}: include not found ${target}`);
    }
  }
  return problems;
}

export async function checkDocs(siteDir: string): Promise<string[]> {
  return [
    ...(await checkParity(siteDir)),
    ...(await checkOverview(siteDir)),
    ...(await checkConfigExamples(siteDir)),
    ...(await checkIncludes(siteDir)),
  ];
}

if (import.meta.main) {
  const problems = await checkDocs(join(import.meta.dir, '../docs/site'));
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log('docs: all checks passed');
}
