import type { Language } from '@standwise/core';
import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { PAGE_CSS } from './styles';

export { PAGE_CSS };

export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 44 40" width="28" height="26" aria-hidden="true">
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
        <style>{raw(PAGE_CSS)}</style>
      </head>
      <body>
        <main class="page">
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
