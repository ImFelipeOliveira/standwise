import { describe, expect, test } from 'bun:test';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import {
  CANONICAL_PUBLIC_URL,
  publicUrlPlugin,
  resolvePublicUrl,
  rewritePublicUrl,
  type UrlToken,
} from './docs-public-url';

const INTERIM = 'https://api-standcast.usefachada.dev';

const token = (type: string, content: string, children: UrlToken[] | null = null): UrlToken => ({
  type,
  content,
  children,
});

describe('resolvePublicUrl', () => {
  test('defaults to the canonical url', () => {
    expect(resolvePublicUrl(undefined)).toBe(CANONICAL_PUBLIC_URL);
    expect(resolvePublicUrl('')).toBe(CANONICAL_PUBLIC_URL);
  });

  test('accepts an https url without a trailing slash', () => {
    expect(resolvePublicUrl(INTERIM)).toBe(INTERIM);
  });

  test('rejects http, a trailing slash and invalid values', () => {
    expect(() => resolvePublicUrl('http://x.example.com')).toThrow('https');
    expect(() => resolvePublicUrl(`${INTERIM}/`)).toThrow('slash');
    expect(() => resolvePublicUrl('not a url')).toThrow('valid');
  });
});

describe('rewritePublicUrl', () => {
  test('rewrites text, inline code and fences, including inline children', () => {
    const tokens = [
      token('inline', '', [
        token('text', `Use ${CANONICAL_PUBLIC_URL} here.`),
        token('code_inline', `${CANONICAL_PUBLIC_URL}/openapi.json`),
      ]),
      token('fence', `curl -fsSL ${CANONICAL_PUBLIC_URL}/install.sh | sh\n`),
      token('html_block', `<a href="${CANONICAL_PUBLIC_URL}">`),
    ];
    rewritePublicUrl(tokens, INTERIM);
    expect(tokens[0]?.children?.map((t) => t.content)).toEqual([
      `Use ${INTERIM} here.`,
      `${INTERIM}/openapi.json`,
    ]);
    expect(tokens[1]?.content).toBe(`curl -fsSL ${INTERIM}/install.sh | sh\n`);
    expect(tokens[2]?.content).toBe(`<a href="${CANONICAL_PUBLIC_URL}">`);
  });

  test('leaves tokens untouched for the canonical url', () => {
    const tokens = [token('text', CANONICAL_PUBLIC_URL)];
    rewritePublicUrl(tokens, CANONICAL_PUBLIC_URL);
    expect(tokens[0]?.content).toBe(CANONICAL_PUBLIC_URL);
  });
});

describe('publicUrlPlugin in the vitepress renderer', () => {
  test('renders the public url in text, inline code, fences and links', async () => {
    const md = await createMarkdownRenderer(process.cwd(), {
      config: (instance) => {
        publicUrlPlugin(INTERIM)(instance);
      },
    });
    const html = md.render(
      [
        `Base URL ${CANONICAL_PUBLIC_URL}, or \`${CANONICAL_PUBLIC_URL}/openapi.json\`.`,
        '',
        `[the api](${CANONICAL_PUBLIC_URL}/health)`,
        '',
        '```sh',
        `curl -fsSL ${CANONICAL_PUBLIC_URL}/install.sh | sh`,
        '```',
      ].join('\n'),
    );
    disposeMdItInstance();
    expect(html).not.toContain('api.standcast.app');
    expect(html).toContain(`${INTERIM}/openapi.json`);
    expect(html).toContain(`href="${INTERIM}/health"`);
    expect(html).toContain('api-standcast.usefachada.dev/install.sh');
  });
});
