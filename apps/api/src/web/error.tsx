import { type Language, type MessageKey, t as translate } from '@standcast/core';
import { Layout } from './layout';
import { ButtonLink, Card, Icon, type IconName } from './ui';

const PAGE_CODES = [
  'unauthorized',
  'forbidden',
  'invalid_state',
  'access_denied',
  'installation_pending',
  'slack_oauth_failed',
  'linear_oauth_failed',
  'not_found',
  'rate_limited',
] as const;

type PageCode = (typeof PAGE_CODES)[number];

const isPageCode = (code: string): code is PageCode =>
  (PAGE_CODES as readonly string[]).includes(code);

type ErrorTone = 'danger' | 'warning' | 'neutral';

const TONES: Partial<Record<PageCode, ErrorTone>> = {
  forbidden: 'danger',
  invalid_state: 'danger',
  access_denied: 'danger',
  slack_oauth_failed: 'danger',
  linear_oauth_failed: 'danger',
  rate_limited: 'warning',
  installation_pending: 'warning',
};

const ICONS: Record<ErrorTone, IconName> = { danger: 'x', warning: 'alert', neutral: 'alert' };

export type ErrorAction = { kind: 'signIn' | 'refresh'; href: string };

export function ErrorPage(props: {
  lang: Language;
  code: string;
  supportEmail: string;
  action?: ErrorAction;
}) {
  const t = (key: MessageKey) => translate(props.lang, key);
  const code = isPageCode(props.code) ? props.code : undefined;
  const prefix = code ?? 'generic';
  const tone = (code && TONES[code]) ?? 'neutral';
  const title = t(`web.error.${prefix}.title`);
  return (
    <Layout lang={props.lang} title={title}>
      <Card class="error-card">
        <span class={`status-icon status-icon-${tone}`}>
          <Icon name={ICONS[tone]} />
        </span>
        <h1>{title}</h1>
        <p class="muted">{t(`web.error.${prefix}.body`)}</p>
        {props.action ? (
          <p>
            <ButtonLink href={props.action.href}>
              {t(props.action.kind === 'signIn' ? 'web.error.signIn' : 'web.error.refresh')}
            </ButtonLink>
          </p>
        ) : null}
        <p class="small muted">
          {t('web.error.questions')}{' '}
          <a href={`mailto:${props.supportEmail}`}>{props.supportEmail}</a>
        </p>
      </Card>
    </Layout>
  );
}
