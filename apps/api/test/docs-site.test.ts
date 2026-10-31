import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkConfigExamples,
  checkDocs,
  checkIncludes,
  checkOverview,
  checkParity,
  checkRootLinks,
  yamlBlocks,
} from '../../../scripts/check-docs';
import { inlineScriptHashes } from '../../../scripts/docs-headers';

const ROOT = join(import.meta.dir, '../../..');
const SITE = join(ROOT, 'docs/site');
const SUPPORT = 'help@sw.test';
const PUBLIC_URL = 'https://api-standwise.usefachada.dev';
const temp = await mkdtemp(join(tmpdir(), 'standwise-docs-'));
const outDir = join(temp, 'dist');

function buildSite(supportEmail: string, out: string) {
  return Bun.spawnSync(['bun', 'run', 'docs:build', '--outDir', out], {
    cwd: ROOT,
    env: { ...process.env, SUPPORT_EMAIL: supportEmail, STANDWISE_PUBLIC_URL: PUBLIC_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

const build = buildSite(SUPPORT, outDir);
const buildOutput = `${build.stdout.toString()}${build.stderr.toString()}`;

afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.filter((entry) => entry.endsWith('.html')).sort();
}

describe('site build', () => {
  test('builds without errors or dead links', () => {
    expect(buildOutput).not.toMatch(/dead link/i);
    expect(build.exitCode).toBe(0);
  });

  test('fails without a support email', async () => {
    const failed = buildSite('', join(temp, 'no-email'));
    expect(failed.exitCode).not.toBe(0);
    expect(failed.stderr.toString()).toContain('SUPPORT_EMAIL');
  });

  test('every english page has a portuguese page and vice versa', async () => {
    const pages = await htmlFiles(outDir);
    const english = pages.filter((p) => !p.startsWith('pt-BR/') && p !== '404.html');
    const portuguese = pages.filter((p) => p.startsWith('pt-BR/')).map((p) => p.slice(6));
    expect(english.length).toBeGreaterThanOrEqual(18);
    expect(portuguese).toEqual(english);
  });

  test('privacy pages carry the support email from the build', async () => {
    for (const page of ['privacy.html', 'pt-BR/privacy.html']) {
      const html = await readFile(join(outDir, page), 'utf8');
      expect(html).toContain(`mailto:${SUPPORT}`);
    }
  });

  test('pages load nothing from third-party hosts', async () => {
    for (const page of await htmlFiles(outDir)) {
      const html = await readFile(join(outDir, page), 'utf8');
      const sources = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map(
        (m) => m[1] ?? '',
      );
      for (const source of sources) {
        expect(source.startsWith('/'), source).toBe(true);
        expect(source.startsWith('//'), source).toBe(false);
        expect(source.startsWith('/docs/'), source).toBe(false);
      }
    }
  });

  test('the site lives at the root of its own domain', async () => {
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('<html lang="en"');
    expect(html).toMatch(/(?:src|href)="\/assets\//);
    expect(html).not.toContain('/docs/');
    expect(html).toContain('href="/logo.svg"');
    const pt = await readFile(join(outDir, 'pt-BR/index.html'), 'utf8');
    expect(pt).toContain('<html lang="pt-BR"');
  });

  test('no page links back to the old /docs/ base', async () => {
    for (const page of await htmlFiles(outDir)) {
      const html = await readFile(join(outDir, page), 'utf8');
      expect(html, page).not.toMatch(/(?:src|href)="\/docs\//);
    }
  });

  test('the api reference points at the public api url in both languages', async () => {
    for (const page of [
      'index.html',
      'pt-BR/index.html',
      'api/overview.html',
      'pt-BR/api/overview.html',
    ]) {
      const html = await readFile(join(outDir, page), 'utf8');
      expect(html, page).toContain(`href="${PUBLIC_URL}/reference"`);
      expect(html, page).not.toContain('https://api.standwise.dev/reference');
    }
  });

  test('ships cloudflare pages headers and redirects', async () => {
    const headers = await readFile(join(outDir, '_headers'), 'utf8');
    const rules = parseHeaders(headers);
    const all = rules.get('/*') ?? new Map<string, string>();
    expect(all.get('strict-transport-security')).toContain('max-age=');
    expect(all.get('x-content-type-options')).toBe('nosniff');
    const csp = all.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    const index = await readFile(join(outDir, 'index.html'), 'utf8');
    const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
    for (const hash of inlineScriptHashes(index)) expect(scriptSrc).toContain(hash);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(rules.get('/assets/*')?.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    const redirects = await readFile(join(outDir, '_redirects'), 'utf8');
    expect(redirects.trim().split('\n')).toContain('/pt-BR /pt-BR/ 301');
  });
});

function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      expect(line.startsWith('/'), line).toBe(true);
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    expect(current, line).toBeDefined();
    const match = /^\s+([A-Za-z0-9-]+):\s*(\S.*)$/.exec(line);
    expect(match, line).not.toBeNull();
    current?.set((match?.[1] ?? '').toLowerCase(), (match?.[2] ?? '').trim());
  }
  return rules;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(temp, 'site-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const VALID = `teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily"
`;

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\`\`\`\n`;

describe('check-docs', () => {
  test('extracts yaml blocks', () => {
    const md = `# x\n\n${fence('yaml', VALID)}\n${fence('json', '{}\n')}\n${fence('yaml', 'a: 1\n')}`;
    expect(yamlBlocks(md)).toEqual([VALID, 'a: 1\n']);
  });

  test('config examples must pass parseConfig in both languages', async () => {
    const good = await fixture({
      'admin/configuration.md': fence('yaml', VALID),
      'pt-BR/admin/configuration.md': fence('yaml', VALID),
    });
    expect(await checkConfigExamples(good)).toEqual([]);
    const bad = await fixture({
      'admin/configuration.md': fence('yaml', VALID),
      'pt-BR/admin/configuration.md': fence('yaml', VALID.replace('"10:00"', '"25:00"')),
    });
    const problems = await checkConfigExamples(bad);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('pt-BR/admin/configuration.md');
    expect(problems[0]).toContain('must be HH:MM (24h)');
  });

  test('config pages without examples fail', async () => {
    const empty = await fixture({
      'admin/configuration.md': '# Config\n',
      'pt-BR/admin/configuration.md': fence('yaml', VALID),
    });
    expect(await checkConfigExamples(empty)).toEqual([
      'admin/configuration.md: no yaml examples found',
    ]);
  });

  test('parity reports pages missing in either language', async () => {
    const dir = await fixture({
      'index.md': '',
      'faq.md': '',
      'pt-BR/index.md': '',
      'pt-BR/admin/install.md': '',
      '.vitepress/theme/x.md': '',
    });
    expect(await checkParity(dir)).toEqual([
      'admin/install.md: missing in English',
      'faq.md: missing in pt-BR',
    ]);
  });

  test('overview must have the required sections in both languages', async () => {
    const dir = await fixture({
      'index.md':
        '# Standwise\n\n## What it is\n\n## Who it is for\n\n## How it works\n\n## What Standwise does not do\n',
      'pt-BR/index.md': '# Standwise\n\n## O que é\n\n## Como funciona\n',
    });
    expect(await checkOverview(dir)).toEqual([
      'pt-BR/index.md: missing section "Para quem é"',
      'pt-BR/index.md: missing section "O que o Standwise não faz"',
    ]);
  });

  test('includes must point to existing files', async () => {
    const dir = await fixture({
      'api/overview.md': '<!--@include: ../guide.md-->\n<!--@include: ../missing.md{3,}-->\n',
      'guide.md': '## Guide\n',
    });
    expect(await checkIncludes(dir)).toEqual(['api/overview.md: include not found ../missing.md']);
  });

  test('links under the old /docs/ base fail', async () => {
    const dir = await fixture({
      'index.md': '[ok](/admin/install)\n',
      'faq.md': '[old](/docs/admin/install)\n',
      'pt-BR/api/overview.md': '<a href="/docs/api">x</a>\n',
    });
    expect(await checkRootLinks(dir)).toEqual([
      'faq.md: link under /docs/, the site is served at the root',
      'pt-BR/api/overview.md: link under /docs/, the site is served at the root',
    ]);
  });

  test('the real site passes every check', async () => {
    expect(await checkDocs(SITE)).toEqual([]);
  });
});
