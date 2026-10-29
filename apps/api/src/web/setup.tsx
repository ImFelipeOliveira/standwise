import { type Language, type MessageKey, t as translate } from '@standwise/core';
import type { SetupStatus } from '@standwise/orchestrator';
import { newConfigFileUrl, newConfigRepoUrl, standwiseYmlTemplate } from './config-template';
import { Layout } from './layout';

const REASONS: Record<string, MessageKey> = {
  no_repo: 'web.setup.reason.no_repo',
  no_file: 'web.setup.reason.no_file',
  no_access: 'web.setup.reason.no_access',
};

const formatDate = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function SetupPage(props: { lang: Language; status: SetupStatus }) {
  const { status } = props;
  const t = (key: MessageKey) => translate(props.lang, key);
  const reasonText = (reason: string) => {
    const key = REASONS[reason];
    return key ? t(key) : '';
  };
  const template = standwiseYmlTemplate(status.login);
  return (
    <Layout lang={props.lang} title={t('web.setup.title')}>
      <h1>{t('web.setup.heading')}</h1>
      <p>
        {t('web.setup.organization')}: <strong>{status.owner}</strong>
      </p>
      <section>
        <h2>{t('web.setup.configTitle')}</h2>
        {status.config.status === 'configured' ? <p>{t('web.setup.configOk')}</p> : null}
        {status.config.status === 'invalid' ? (
          <>
            <p>{t('web.setup.configInvalid')}</p>
            <ul>
              {status.config.errors.map((e) => (
                <li>
                  <code>{e.path}</code>: {e.message}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {status.config.status === 'unconfigured' ? (
          <>
            <p>{t('web.setup.configMissing')}</p>
            <p>
              {t('web.setup.reason')}: <code>{status.config.reason}</code>{' '}
              {reasonText(status.config.reason)}
            </p>
            <p>{t('web.setup.instruction')}</p>
          </>
        ) : null}
        {
          <>
            <p>
              {status.configRepo.exists ? (
                <a
                  class="button"
                  href={newConfigFileUrl(status.owner, status.configRepo.defaultBranch, template)}
                >
                  {t('web.setup.createFile')}
                </a>
              ) : (
                <a class="button" href={newConfigRepoUrl()}>
                  {t('web.setup.createRepo')}
                </a>
              )}
            </p>
            <h2>{t('web.setup.template')}</h2>
            <pre>{template}</pre>
          </>
        }
      </section>
      <section>
        <h2>{t('web.slack.title')}</h2>
        {status.slack.connected ? (
          <p>
            {t('web.slack.connected')} <code>{status.slack.teamId}</code>
          </p>
        ) : (
          <a class="button" href={`/connect/slack?installation_id=${status.installationId}`}>
            {t('web.slack.connect')}
          </a>
        )}
      </section>
      <section>
        <h2>{t('web.setup.failedTitle')}</h2>
        {status.failedDeliveries.length === 0 ? (
          <p>{t('web.setup.noFailed')}</p>
        ) : (
          <ul>
            {status.failedDeliveries.map((d) => (
              <li>
                {t('web.setup.team')}: {d.team} | {t('web.setup.date')}: {formatDate(d.at)} |{' '}
                {t('web.setup.error')}: <code>{d.error}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p>
        {t('web.setup.support')}:{' '}
        <a href={`mailto:${status.supportEmail}`}>{status.supportEmail}</a>
      </p>
    </Layout>
  );
}
