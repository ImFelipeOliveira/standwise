export const CANONICAL_PUBLIC_URL = 'https://api.standcast.app';

export type UrlToken = {
  type: string;
  content: string;
  children: UrlToken[] | null;
  attrGet?: (name: string) => string | null;
  attrSet?: (name: string, value: string) => void;
};

type CoreRuler = { push: (name: string, rule: (state: { tokens: UrlToken[] }) => void) => void };

export function resolvePublicUrl(value: string | undefined): string {
  if (value === undefined || value === '') return CANONICAL_PUBLIC_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`STANDCAST_PUBLIC_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`STANDCAST_PUBLIC_URL must use https: ${value}`);
  }
  if (value.endsWith('/')) {
    throw new Error(`STANDCAST_PUBLIC_URL must not end with a slash: ${value}`);
  }
  return value;
}

const REWRITTEN = new Set(['text', 'code_inline', 'fence', 'code_block']);

export function rewritePublicUrl(tokens: UrlToken[], publicUrl: string): void {
  if (publicUrl === CANONICAL_PUBLIC_URL) return;
  for (const token of tokens) {
    if (REWRITTEN.has(token.type)) {
      token.content = token.content.replaceAll(CANONICAL_PUBLIC_URL, publicUrl);
    }
    const href = token.type === 'link_open' ? token.attrGet?.('href') : null;
    if (href?.startsWith(CANONICAL_PUBLIC_URL)) {
      token.attrSet?.('href', href.replaceAll(CANONICAL_PUBLIC_URL, publicUrl));
    }
    if (token.children) rewritePublicUrl(token.children, publicUrl);
  }
}

export function publicUrlPlugin(publicUrl: string) {
  return (md: { core: { ruler: CoreRuler } }): void => {
    md.core.ruler.push('standcast_public_url', (state) =>
      rewritePublicUrl(state.tokens, publicUrl),
    );
  };
}
