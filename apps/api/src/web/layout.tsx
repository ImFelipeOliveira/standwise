import { type Language, type MessageKey, t as translate } from '@standwise/core';
import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { PAGE_CSS } from './styles';
import { SubmitButton } from './ui';

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

export type HeaderProps = {
  owner: string;
  installations: { id: number; owner: string }[];
  currentId: number;
  csrf: string;
};

function Org(props: { lang: Language; header: HeaderProps }) {
  const t = (key: MessageKey) => translate(props.lang, key);
  const { header } = props;
  if (header.installations.length < 2) return <strong class="topbar-org">{header.owner}</strong>;
  return (
    <form method="get" action="/setup" class="topbar-switch">
      <label class="sr-only" for="installation-switch">
        {t('web.setup.organization')}
      </label>
      <select name="installation_id" id="installation-switch">
        {header.installations.map((i) =>
          i.id === header.currentId ? (
            <option value={i.id} selected>
              {i.owner}
            </option>
          ) : (
            <option value={i.id}>{i.owner}</option>
          ),
        )}
      </select>
      <button type="submit" class="btn btn-secondary">
        {t('web.header.switch')}
      </button>
    </form>
  );
}

function Header(props: { lang: Language; header?: HeaderProps }) {
  const t = (key: MessageKey) => translate(props.lang, key);
  const { header } = props;
  return (
    <header class="topbar">
      <span class="topbar-brand">
        <Logo />
        <span>Standwise</span>
      </span>
      {header ? (
        <>
          <span class="topbar-sep" aria-hidden="true">
            /
          </span>
          <Org lang={props.lang} header={header} />
          <nav class="topbar-actions" aria-label={t('web.header.nav')}>
            <a href={props.lang === 'pt-BR' ? '/docs/pt-BR/' : '/docs/'} class="topbar-link">
              {t('web.header.docs')}
            </a>
            <form method="post" action="/logout">
              <input type="hidden" name="csrf" value={header.csrf} />
              <SubmitButton variant="secondary">{t('web.setup.logout')}</SubmitButton>
            </form>
          </nav>
        </>
      ) : null}
    </header>
  );
}

export function Layout(props: {
  lang: Language;
  title: string;
  header?: HeaderProps;
  children?: Child;
}) {
  return (
    <html lang={props.lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{raw(PAGE_CSS)}</style>
      </head>
      <body>
        <div class="page">
          <Header lang={props.lang} header={props.header} />
          <main>{props.children}</main>
        </div>
      </body>
    </html>
  );
}
