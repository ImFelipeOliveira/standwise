import type { Language } from '@standcast/core';
import type { SetupStatus } from '@standcast/orchestrator';
import { Layout } from './layout';
import {
  ApiKeysCard,
  type NewApiKey,
  type NewWebhook,
  SecretAlerts,
  WebhooksCard,
} from './setup-admin';
import { FAILURE_KIND_LABELS, formatDate, type Translate, translator } from './setup-labels';
import { SetupSteps, setupProgress } from './setup-steps';
import { Badge, Card } from './ui';

export type { NewApiKey, NewWebhook };

function FailedDeliveries(props: { t: Translate; lang: Language; status: SetupStatus }) {
  const { t, status } = props;
  return (
    <Card id="failed">
      <h2>{t('web.setup.failedTitle')}</h2>
      {status.teamFailures.length === 0 && status.personFailures.length === 0 ? (
        <p class="small muted">{t('web.setup.noFailed')}</p>
      ) : null}
      {status.teamFailures.length > 0 ? (
        <>
          <h3>{t('web.setup.teamFailures')}</h3>
          <ul class="item-list">
            {status.teamFailures.map((d) => (
              <li class="item">
                <div class="item-head">
                  <strong>{t(FAILURE_KIND_LABELS[d.kind])}</strong>
                  <span class="small muted">{formatDate(props.lang, d.at)}</span>
                </div>
                <p class="small muted item-meta">
                  {t('web.setup.team')}: {d.team}
                </p>
                <p class="small item-meta">
                  <code>{d.error}</code>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {status.personFailures.length > 0 ? (
        <>
          <h3>{t('web.setup.personFailures')}</h3>
          <ul class="item-list">
            {status.personFailures.map((d) => (
              <li class="item">
                <div class="item-head">
                  <strong>{t(FAILURE_KIND_LABELS[d.kind])}</strong>
                  <span class="small muted">{formatDate(props.lang, d.lastAt)}</span>
                </div>
                <p class="small muted item-meta">
                  {t('web.setup.count')}: {d.count}
                </p>
                <p class="small item-meta">
                  <code>{d.error}</code>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

export function SetupPage(props: {
  lang: Language;
  status: SetupStatus;
  csrf: string;
  docsUrl: string;
  newKey?: NewApiKey;
  newWebhook?: NewWebhook;
}) {
  const { status, lang } = props;
  const t = translator(lang);
  const progress = setupProgress(status);
  return (
    <Layout
      lang={lang}
      title={t('web.setup.title')}
      header={{
        owner: status.owner,
        installations: status.installations,
        currentId: status.installationId,
        csrf: props.csrf,
        docsUrl: props.docsUrl,
      }}
    >
      <div class="page-head">
        <div>
          <h1>{t('web.setup.heading')}</h1>
          <p class="muted">{t('web.setup.subtitle')}</p>
        </div>
        <Badge tone={progress.done === progress.total ? 'success' : 'neutral'}>
          {t('web.setup.progress', progress)}
        </Badge>
      </div>
      <div class="layout">
        <div class="layout-main stack">
          <SecretAlerts t={t} newKey={props.newKey} newWebhook={props.newWebhook} />
          <SetupSteps t={t} lang={lang} status={status} />
        </div>
        <aside class="layout-aside stack">
          <FailedDeliveries t={t} lang={lang} status={status} />
          {status.apiKeys.manage ? (
            <ApiKeysCard
              t={t}
              lang={lang}
              csrf={props.csrf}
              installationId={status.installationId}
              apiKeys={status.apiKeys}
            />
          ) : null}
          {status.webhooks.manage ? (
            <WebhooksCard
              t={t}
              lang={lang}
              csrf={props.csrf}
              installationId={status.installationId}
              webhooks={status.webhooks}
            />
          ) : null}
          <p class="small muted">
            {t('web.setup.support')}:{' '}
            <a href={`mailto:${status.supportEmail}`}>{status.supportEmail}</a>
          </p>
        </aside>
      </div>
    </Layout>
  );
}
