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
    ...(await checkRootLinks(siteDir)),
  ];
}

export async function checkRootLinks(siteDir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const page of await listPages(siteDir)) {
    const text = (await readPage(siteDir, page)) ?? '';
    if (/\]\(\/docs\/|(?:href|src)="\/docs\//.test(text)) {
      problems.push(`${page}: link under /docs/, the site is served at the root`);
    }
  }
  return problems;
}

const CANONICAL_INSTALL_URL = 'https://api.standwise.dev/install.sh';
export const PUBLISHED_INSTALL_URL = 'https://api-standwise.usefachada.dev/install.sh';
const PUBLISHED_FILES = ['README.md', 'packages/plugin/skills/daily/SKILL.md'];

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries
    .map((entry) => entry.split('\\').join('/'))
    .filter((entry) => entry.endsWith('.md'))
    .filter((entry) => !entry.split('/').some((part) => IGNORED_DIRS.has(part)))
    .map((entry) => join(dir, entry));
}

export function installUrlProblems(
  file: string,
  text: string,
  expected: string = CANONICAL_INSTALL_URL,
): string[] {
  const problems: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)'"`>]*install\.sh/g)) {
    if (match[0] !== expected) {
      problems.push(`${file}: install url must be ${expected}, found ${match[0]}`);
    }
  }
  if (text.includes('<standwise-host>')) problems.push(`${file}: placeholder <standwise-host>`);
  return problems;
}

export async function checkInstallUrl(root: string): Promise<string[]> {
  const files = [
    ...PUBLISHED_FILES.map((file) => join(root, file)),
    ...(await markdownFiles(join(root, 'docs/site'))),
  ];
  const problems: string[] = [];
  for (const file of files) {
    const relative = file.slice(root.length + 1);
    const expected = PUBLISHED_FILES.includes(relative)
      ? PUBLISHED_INSTALL_URL
      : CANONICAL_INSTALL_URL;
    problems.push(...installUrlProblems(relative, await readFile(file, 'utf8'), expected));
  }
  return problems;
}

const SUGGESTION_KINDS = /\b(pr_no_review|ci_failing|card_stale)\b/;
const MANAGER_SECTION = /^#{2,3} (Manager tools|Tools de gestor)\s*$/;
const ORG_OUTPUT_FILES = [
  'docs/api/guides/authentication.md',
  'docs/api/guides/errors.md',
  'docs/api/guides/pagination.md',
  'docs/api/guides/rate-limits.md',
  'docs/api/guides/versioning.md',
  'docs/api/guides/webhooks.md',
  'docs/site/api/overview.md',
  'docs/site/api/webhooks.md',
  'docs/site/admin/api-keys.md',
  'docs/site/admin/webhooks.md',
  'docs/site/pt-BR/api/overview.md',
  'docs/site/pt-BR/api/webhooks.md',
  'docs/site/pt-BR/admin/api-keys.md',
  'docs/site/pt-BR/admin/webhooks.md',
];
const MANAGER_SECTION_FILES = ['docs/api/guides/mcp.md', 'docs/site/pt-BR/members/mcp.md'];

export function managerSection(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => MANAGER_SECTION.test(line));
  if (start === -1) return '';
  const level = (lines[start] ?? '').match(/^#+/)?.[0].length ?? 2;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const heading = line.match(/^(#+) /);
    return heading !== null && (heading[1] ?? '').length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

export function suggestionLeakProblems(file: string, text: string): string[] {
  const match = text.match(SUGGESTION_KINDS);
  if (match === null) return [];
  return [
    `${file}: suggestion kind ${match[1]} must not appear in docs about org or manager outputs`,
  ];
}

export async function checkSuggestionLeaks(root: string): Promise<string[]> {
  const problems: string[] = [];
  for (const file of ORG_OUTPUT_FILES) {
    const text = await readFile(join(root, file), 'utf8').catch(() => null);
    if (text === null) {
      problems.push(`${file}: page not found`);
      continue;
    }
    problems.push(...suggestionLeakProblems(file, text));
  }
  for (const file of MANAGER_SECTION_FILES) {
    const text = await readFile(join(root, file), 'utf8').catch(() => null);
    if (text === null) {
      problems.push(`${file}: page not found`);
      continue;
    }
    const section = managerSection(text);
    if (section === '') problems.push(`${file}: manager tools section not found`);
    problems.push(...suggestionLeakProblems(`${file} (manager tools)`, section));
  }
  return problems;
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..');
  const problems = [
    ...(await checkDocs(join(root, 'docs/site'))),
    ...(await checkInstallUrl(root)),
    ...(await checkSuggestionLeaks(root)),
  ];
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log('docs: all checks passed');
}
