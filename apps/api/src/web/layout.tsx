import type { Language } from '@standwise/core';
import type { Child } from 'hono/jsx';

export const BRAND = {
  accent: '#3B4BC8',
  text: '#15171C',
  muted: '#4A5060',
  background: '#F5F6F8',
};

const css = `
body { margin: 0; background: ${BRAND.background}; color: ${BRAND.text}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; line-height: 1.5; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
header { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; font-weight: 700; font-size: 20px; }
section { background: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
h1 { font-size: 24px; margin: 0 0 8px; }
h2 { font-size: 16px; margin: 0 0 8px; }
p, li { color: ${BRAND.muted}; }
a.button { display: inline-block; background: ${BRAND.accent}; color: #fff; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-weight: 600; }
a { color: ${BRAND.accent}; }
pre { background: ${BRAND.background}; padding: 12px; border-radius: 8px; overflow-x: auto; color: ${BRAND.text}; }
code { color: ${BRAND.text}; }
`;

export function Logo() {
  return (
    <svg viewBox="0 0 44 40" width="28" height="26" fill={BRAND.accent} aria-hidden="true">
      <rect x="0" y="20" width="11" height="20" rx="1.5" />
      <rect x="16" y="10" width="11" height="30" rx="1.5" />
      <rect x="32" y="0" width="11" height="40" rx="1.5" />
    </svg>
  );
}

export function Layout(props: { lang: Language; title: string; children?: Child }) {
  return (
    <html lang={props.lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{css}</style>
      </head>
      <body>
        <main>
          <header>
            <Logo />
            <span>Standwise</span>
          </header>
          {props.children}
        </main>
      </body>
    </html>
  );
}
