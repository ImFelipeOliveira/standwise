import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkConfigExamples,
  checkDocs,
  checkIncludes,
  checkOverview,
  checkParity,
  yamlBlocks,
} from '../../../scripts/check-docs';
import { createTestApp } from './support';

const ROOT = join(import.meta.dir, '../../..');
const SITE = join(ROOT, 'docs/site');
const SUPPORT = 'help@sw.test';
const temp = await mkdtemp(join(tmpdir(), 'standwise-docs-'));
const outDir = join(temp, 'dist');

function buildSite(supportEmail: string, out: string) {
  return Bun.spawnSync(['bun', 'run', 'docs:build', '--outDir', out], {
    cwd: ROOT,
    env: { ...process.env, SUPPORT_EMAIL: supportEmail },
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

function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '')
        .digest('base64')}'`,
  );
}

const app = () => createTestApp({ docsDir: outDir }).app;

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
      for (const source of sources) expect(source.startsWith('/docs/')).toBe(true);
    }
  });
});

describe('served site', () => {
  test('serves the english overview at /docs/', async () => {
    const res = await app().request('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<title>Standwise');
    expect(html).toContain('<html lang="en"');
  });

  test('serves the portuguese overview at /docs/pt-BR/', async () => {
    const res = await app().request('/docs/pt-BR/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html lang="pt-BR"');
  });

  test('redirects /docs/pt-BR to /docs/pt-BR/ permanently', async () => {
    const res = await app().request('/docs/pt-BR');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/docs/pt-BR/');
  });

  test('pages are not sniffed and revalidated on every visit', async () => {
    for (const path of ['/docs/', '/docs/pt-BR/', '/docs/admin/configuration']) {
      const res = await app().request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  test('hashed assets are not sniffed and cached for a year', async () => {
    const [asset] = (await readdir(join(outDir, 'assets'))).filter((f) => f.endsWith('.js'));
    const res = await app().request(`/docs/assets/${asset}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  test('serves pages with and without the html extension', async () => {
    expect((await app().request('/docs/privacy.html')).status).toBe(200);
    expect((await app().request('/docs/admin/configuration')).status).toBe(200);
  });

  test('serves assets with their content type', async () => {
    const res = await app().request('/docs/logo.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
  });

  test('redirects /docs to the site and /docs/api/ to the reference', async () => {
    const root = await app().request('/docs');
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/docs/');
    const reference = await app().request('/docs/api/');
    expect(reference.status).toBe(301);
    expect(reference.headers.get('location')).toBe('/docs/api');
  });

  test('keeps the api reference on scalar, linking back to the site', async () => {
    const res = await app().request('/docs/api');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('/openapi.json');
    const doc = (await (await app().request('/openapi.json')).json()) as {
      info: { description: string };
    };
    expect(doc.info.description).toContain('](/docs/)');
  });

  test('answers unknown pages and traversal attempts with 404', async () => {
    for (const path of [
      '/docs/nope.html',
      '/docs/%2e%2e/package.json',
      '/docs/..%2fpackage.json',
    ]) {
      const res = await app().request(path);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('"name": "standwise"');
    }
  });

  test('sends a self-only content security policy that allows the inline scripts', async () => {
    for (const path of ['/docs/', '/docs/pt-BR/admin/configuration.html']) {
      const res = await app().request(path);
      const csp = res.headers.get('content-security-policy') ?? '';
      const html = await res.text();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/https?:/);
      const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? '';
      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).not.toContain('unsafe-inline');
      const hashes = inlineScriptHashes(html);
      expect(hashes.length).toBeGreaterThan(0);
      for (const hash of hashes) expect(scriptSrc).toContain(hash);
    }
  });

  test('does not serve the site when it was not built', async () => {
    const res = await createTestApp({ docsDir: join(temp, 'missing') }).app.request('/docs/');
    expect(res.status).toBe(404);
  });
});

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

  test('the real site passes every check', async () => {
    expect(await checkDocs(SITE)).toEqual([]);
  });
});
