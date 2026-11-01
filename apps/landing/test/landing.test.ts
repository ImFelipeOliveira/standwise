import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(import.meta.dir, '../public');
const SITE = 'https://standcast.usefachada.dev';
const API = 'https://api-standcast.usefachada.dev';
const DOCS = 'https://docs-standcast.usefachada.dev';

const PAGES = [
  { file: 'index.html', url: `${SITE}/`, locale: 'en' },
  { file: 'pt-BR/index.html', url: `${SITE}/pt-BR/`, locale: 'pt-BR' },
];

function read(path: string): string {
  return readFileSync(join(PUBLIC, path), 'utf8');
}

function htmlFiles(): string[] {
  return readdirSync(PUBLIC, { recursive: true, encoding: 'utf8' }).filter((path) =>
    path.endsWith('.html'),
  );
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

function metaContent(html: string, key: string): string | undefined {
  const tag = tags(html, 'meta').find(
    (meta) => attr(meta, 'name') === key || attr(meta, 'property') === key,
  );
  return tag ? attr(tag, 'content') : undefined;
}

function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(
    (match) => {
      const parsed = JSON.parse(match[1] ?? '') as
        | Record<string, unknown>
        | Record<string, unknown>[];
      return Array.isArray(parsed) ? parsed : [parsed];
    },
  );
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

function decode(text: string): string {
  return text
    .split(/<[^>]*>/)
    .join('')
    .replace(/&(?:amp|quot|#39|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity)
    .trim();
}

describe('landing', () => {
  test('no inline scripts or style attributes', () => {
    const files = htmlFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const html = read(file);
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/<style\b/);
      expect(html).not.toMatch(/\son[a-z]+=/);
      for (const script of tags(html, 'script')) {
        const isData = attr(script, 'type') === 'application/ld+json';
        expect(isData || attr(script, 'src') !== undefined).toBe(true);
      }
    }
  });

  test('head tags present', () => {
    for (const page of PAGES) {
      const html = read(page.file);
      expect(html).toMatch(new RegExp(`<html lang="${page.locale}"`));
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      const description = metaContent(html, 'description') ?? '';
      expect(description.length).toBeGreaterThan(50);
      if (page.locale === 'en') expect(description.length).toBeLessThanOrEqual(155);
      const links = tags(html, 'link');
      const canonical = links.find((link) => attr(link, 'rel') === 'canonical');
      expect(canonical && attr(canonical, 'href')).toBe(page.url);
      const alternates = Object.fromEntries(
        links
          .filter((link) => attr(link, 'rel') === 'alternate' && attr(link, 'hreflang'))
          .map((link) => [attr(link, 'hreflang'), attr(link, 'href')]),
      );
      expect(alternates).toEqual({
        en: `${SITE}/`,
        'pt-BR': `${SITE}/pt-BR/`,
        'x-default': `${SITE}/`,
      });
      expect(metaContent(html, 'og:image')).toBe(`${SITE}/og.png`);
      expect(metaContent(html, 'twitter:card')).toBe('summary_large_image');
      expect(metaContent(html, 'theme-color')).toBeDefined();
      expect(links.some((link) => attr(link, 'rel') === 'icon')).toBe(true);
      const markdown = links.find((link) => attr(link, 'type') === 'text/markdown');
      expect(markdown && attr(markdown, 'href')).toBe(
        page.locale === 'en' ? '/index.md' : '/pt-BR/index.md',
      );
      const types = jsonLd(html).map((entry) => entry['@type']);
      expect(types).toContain('SoftwareApplication');
      expect(types).toContain('FAQPage');
    }
    const titles = PAGES.map((page) => read(page.file).match(/<title>([^<]+)<\/title>/)?.[1]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('faq json-ld matches the page', () => {
    for (const page of PAGES) {
      const html = read(page.file);
      const summaries = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((match) =>
        decode(match[1] ?? ''),
      );
      expect(summaries.length).toBeGreaterThanOrEqual(5);
      const faq = jsonLd(html).find((entry) => entry['@type'] === 'FAQPage') as {
        mainEntity: { name: string; acceptedAnswer: { text: string } }[];
      };
      expect(faq.mainEntity.map((entry) => entry.name)).toEqual(summaries);
      const answers = [...html.matchAll(/<summary>[\s\S]*?<\/summary><p>([\s\S]*?)<\/p>/g)].map(
        (match) => decode(match[1] ?? ''),
      );
      expect(faq.mainEntity.map((entry) => entry.acceptedAnswer.text)).toEqual(answers);
    }
  });

  test('form posts to the api', () => {
    for (const page of PAGES) {
      const html = read(page.file);
      const forms = tags(html, 'form');
      expect(forms).toHaveLength(1);
      const form = forms[0] ?? '';
      expect(attr(form, 'action')).toBe(`${API}/beta`);
      expect(attr(form, 'method')).toBe('post');
      const names = [...tags(html, 'input'), ...tags(html, 'select')].map((tag) =>
        attr(tag, 'name'),
      );
      for (const name of [
        'name',
        'email',
        'team_size',
        'chat',
        'tracker',
        'locale',
        'company_website',
      ]) {
        expect(names).toContain(name);
      }
      const locale = tags(html, 'input').find((tag) => attr(tag, 'name') === 'locale') ?? '';
      expect(attr(locale, 'type')).toBe('hidden');
      expect(attr(locale, 'value')).toBe(page.locale);
      const email = tags(html, 'input').find((tag) => attr(tag, 'name') === 'email') ?? '';
      expect(attr(email, 'type')).toBe('email');
      expect(email).toMatch(/\srequired[\s>]/);
      const honeypot = tags(html, 'input').find((tag) => attr(tag, 'name') === 'company_website');
      expect(honeypot && attr(honeypot, 'tabindex')).toBe('-1');
      expect(honeypot && attr(honeypot, 'autocomplete')).toBe('off');
      const options = tags(html, 'option').map((tag) => attr(tag, 'value'));
      for (const value of [
        '3-5',
        '6-15',
        '16+',
        'slack',
        'google_chat',
        'linear',
        'jira',
        'github',
        'other',
      ]) {
        expect(options).toContain(value);
      }
      expect(html).toMatch(/id="beta-invalid"/);
      expect(html).not.toMatch(/\svalue="[^"]*@/);
      const name = tags(html, 'input').find((tag) => attr(tag, 'name') === 'name') ?? '';
      expect(attr(name, 'maxlength')).toBe('120');
      expect(attr(email, 'maxlength')).toBe('254');
      for (const select of tags(html, 'select')) expect(select).toMatch(/\srequired[\s>]/);
      const honeypotAt = html.indexOf('name="company_website"');
      const wrapperAt = html.lastIndexOf('<div', honeypotAt);
      const wrapper = html.slice(wrapperAt, honeypotAt);
      expect(wrapper).toMatch(/^<div\b[^>]*\saria-hidden="true"/);
      expect(wrapper).not.toContain('</div>');
    }
  });

  test('invalid box is shown only as the target', () => {
    const css = read('styles.css').replace(/\s+/g, ' ');
    expect(css).toMatch(/\.invalid \{[^}]*display: none/);
    expect(css).toMatch(/(\.invalid|#beta-invalid):target \{[^}]*display: block/);
  });

  test('pt-BR page links the pt-BR docs', () => {
    const docsLinks = [
      ...read('pt-BR/index.html').matchAll(
        /href="(https:\/\/docs-standcast\.usefachada\.dev[^"]*)"/g,
      ),
    ].map((match) => match[1] ?? '');
    expect(docsLinks.length).toBeGreaterThan(0);
    for (const link of docsLinks) expect(link).toStartWith(`${DOCS}/pt-BR/`);
  });

  test('csp allows the form and its redirect targets', () => {
    expect(read('_headers')).toContain(
      `form-action ${API} ${DOCS} ${SITE}; base-uri 'none'; frame-ancestors 'none'`,
    );
  });

  test('csp is self-only for styles, fonts and robots fetches', () => {
    const headers = read('_headers');
    expect(headers).toContain("style-src 'self';");
    expect(headers).toContain("font-src 'self';");
    expect(headers).toContain("connect-src 'self';");
    expect(headers).toContain('/fonts/*\n  Cache-Control: public, max-age=31536000, immutable');
  });

  test('fonts are self-hosted and the preloaded file exists', () => {
    for (const file of htmlFiles()) {
      const html = read(file);
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('fonts.gstatic.com');
      const preload = tags(html, 'link').find((tag) => attr(tag, 'rel') === 'preload');
      expect(preload).toBeDefined();
      expect(attr(preload ?? '', 'as')).toBe('font');
      expect(attr(preload ?? '', 'type')).toBe('font/woff2');
      expect(preload).toContain('crossorigin');
      expect(existsSync(join(PUBLIC, attr(preload ?? '', 'href') ?? ''))).toBe(true);
    }
    const css = read('styles.css');
    expect(css).not.toContain('googleapis');
    for (const [, path] of css.matchAll(/url\('([^']+\.woff2)'\)/g)) {
      expect(existsSync(join(PUBLIC, path ?? ''))).toBe(true);
    }
    expect(existsSync(join(PUBLIC, 'fonts/LICENSE-OFL.txt'))).toBe(true);
  });

  test('copy makes no undecided promises and links the self-hosting readme', () => {
    const files = ['index.html', 'pt-BR/index.html', 'index.md', 'pt-BR/index.md', 'llms.txt'];
    for (const file of files) {
      const text = read(file);
      for (const phrase of [
        'special terms',
        'condições especiais',
        'two working days',
        'dois dias úteis',
        '20-minute',
        '20 minutos',
        'self-hosting guide',
        'guia de self-hosting',
      ]) {
        expect(text).not.toContain(phrase);
      }
    }
    for (const file of PAGES.map((page) => page.file)) {
      expect(read(file)).toContain(
        'href="https://github.com/ImFelipeOliveira/standcast#self-hosting"',
      );
    }
  });

  test('no hidden-at-rest content', () => {
    const css = read('styles.css').replace(/\s+/g, '');
    const blocks: { start: number; end: number }[] = [];
    let index = css.indexOf('@media(prefers-reduced-motion:no-preference){');
    while (index !== -1) {
      let depth = 0;
      let end = index;
      for (let i = css.indexOf('{', index); i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      blocks.push({ start: index, end });
      index = css.indexOf('@media(prefers-reduced-motion:no-preference){', end);
    }
    for (const match of css.matchAll(/opacity:0(?![.\d])/g)) {
      const at = match.index ?? 0;
      expect(blocks.some((block) => at > block.start && at < block.end)).toBe(true);
      const ruleStart = css.lastIndexOf('}', at);
      const open = css.lastIndexOf('{', at);
      const selector = css.slice(Math.max(ruleStart, css.lastIndexOf('{', open - 1)) + 1, open);
      expect(selector).toContain('.play');
    }
  });

  test('robots allows ai crawlers and points to the sitemap', () => {
    const robots = read('robots.txt');
    expect(robots).toMatch(/User-agent: \*\nAllow: \//);
    for (const bot of [
      'GPTBot',
      'ClaudeBot',
      'Claude-SearchBot',
      'PerplexityBot',
      'Google-Extended',
      'OAI-SearchBot',
    ]) {
      expect(robots).toMatch(new RegExp(`User-agent: ${bot}\\nAllow: /`));
    }
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  test('sitemap lists both locales', () => {
    const sitemap = read('sitemap.xml');
    expect(sitemap).toContain(`<loc>${SITE}/</loc>`);
    expect(sitemap).toContain(`<loc>${SITE}/pt-BR/</loc>`);
    expect(sitemap).toContain('hreflang="pt-BR"');
  });

  test('llms.txt links docs llms and openapi', () => {
    const llms = read('llms.txt');
    expect(llms).toMatch(/^# Standcast\n\n> /);
    for (const url of [
      `${SITE}/index.md`,
      `${DOCS}/llms.txt`,
      `${DOCS}/llms-full.txt`,
      `${DOCS}/pt-BR/llms.txt`,
      `${DOCS}/pt-BR/llms-full.txt`,
      `${API}/llms.txt`,
      `${API}/openapi.json`,
      `${DOCS}/admin/install`,
      `${DOCS}/admin/configuration`,
      `${DOCS}/members/mcp`,
      `${DOCS}/api/overview`,
      'https://github.com/ImFelipeOliveira/standcast/blob/main/llms.txt',
    ]) {
      expect(llms).toContain(`](${url}`);
    }
  });

  test('internal links resolve', () => {
    for (const file of htmlFiles()) {
      const html = read(file);
      const refs = [...html.matchAll(/\s(?:href|src)="(\/[^"#?]*)/g)].map(
        (match) => match[1] ?? '',
      );
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        const path = join(PUBLIC, ref.endsWith('/') ? `${ref}index.html` : ref);
        expect(existsSync(path) && statSync(path).isFile()).toBe(true);
      }
    }
  });
});
