import { type Language, type MessageKey, t as translate } from '@standwise/core';
import { Layout } from './layout';

const PAGE_CODES = [
  'unauthorized',
  'forbidden',
  'invalid_state',
  'access_denied',
  'installation_pending',
  'slack_oauth_failed',
  'not_found',
  'rate_limited',
] as const;

type PageCode = (typeof PAGE_CODES)[number];

const isPageCode = (code: string): code is PageCode =>
  (PAGE_CODES as readonly string[]).includes(code);

export type ErrorAction = { kind: 'signIn' | 'refresh'; href: string };

export function ErrorPage(props: { lang: Language; code: string; action?: ErrorAction }) {
  const t = (key: MessageKey) => translate(props.lang, key);
  const prefix = isPageCode(props.code) ? props.code : 'generic';
  const title = t(`web.error.${prefix}.title`);
  return (
    <Layout lang={props.lang} title={title}>
      <section>
        <h1>{title}</h1>
        <p>{t(`web.error.${prefix}.body`)}</p>
        {props.action ? (
          <a class="button" href={props.action.href}>
            {t(props.action.kind === 'signIn' ? 'web.error.signIn' : 'web.error.refresh')}
          </a>
        ) : null}
      </section>
    </Layout>
  );
}
