import { type Language, type MessageKey, t as translate } from '@standwise/core';
import { API_KEY_SCOPES, type ApiKeyScope } from '@standwise/db';
import type { SetupStatus } from '@standwise/orchestrator';
import { newConfigFileUrl, newConfigRepoUrl, standwiseYmlTemplate } from './config-template';
import { Layout } from './layout';

const REASONS: Record<string, MessageKey> = {
  no_repo: 'web.setup.reason.no_repo',
  no_file: 'web.setup.reason.no_file',
  no_access: 'web.setup.reason.no_access',
};

const SCOPE_LABELS: Record<ApiKeyScope, MessageKey> = {
  'teams:read': 'web.apiKeys.scope.teams_read',
  'dailies:read': 'web.apiKeys.scope.dailies_read',
  'digests:read': 'web.apiKeys.scope.digests_read',
  'blockers:read': 'web.apiKeys.scope.blockers_read',
};

export type NewApiKey = { name: string; key: string };

const formatDate = (lang: Language, date: Date) =>
  new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(
    date,
  );

export function SetupPage(props: {
  lang: Language;
  status: SetupStatus;
  csrf: string;
  newKey?: NewApiKey;
}) {
  const { status } = props;
  const t = (key: MessageKey) => translate(props.lang, key);
  const reasonText = (reason: string) => {
    const key = REASONS[reason];
    return key ? t(key) : '';
  };
  const template = standwiseYmlTemplate(status.login, t('web.template.teamName'));
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
      </section>
      <section>
        <h2>{t('web.slack.title')}</h2>
        {status.slack.connected ? (
          <p>
            {t('web.slack.connected')} <code>{status.slack.workspace}</code>
          </p>
        ) : (
          <a class="button" href={`/connect/slack?installation_id=${status.installationId}`}>
            {t('web.slack.connect')}
          </a>
        )}
      </section>
      {status.apiKeys.manage ? (
        <section>
          <h2>{t('web.apiKeys.title')}</h2>
          <p>{t('web.apiKeys.description')}</p>
          {props.newKey ? (
            <div class="secret" role="alert">
              <strong>
                {translate(props.lang, 'web.apiKeys.created', { name: props.newKey.name })}
              </strong>
              <p>{t('web.apiKeys.copyNow')}</p>
              <p>{t('web.apiKeys.revokeHint')}</p>
              <pre>{props.newKey.key}</pre>
            </div>
          ) : null}
          {status.apiKeys.keys.length === 0 ? (
            <p>{t('web.apiKeys.none')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('web.apiKeys.name')}</th>
                  <th>{t('web.apiKeys.prefix')}</th>
                  <th>{t('web.apiKeys.scopes')}</th>
                  <th>{t('web.apiKeys.createdAt')}</th>
                  <th>{t('web.apiKeys.lastUsed')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {status.apiKeys.keys.map((k) => (
                  <tr>
                    <td>{k.name}</td>
                    <td>
                      <code>swk_{k.prefix}</code>
                    </td>
                    <td>{k.scopes.map((scope) => t(SCOPE_LABELS[scope])).join(', ')}</td>
                    <td>{formatDate(props.lang, k.createdAt)}</td>
                    <td>
                      {k.lastUsedAt ? formatDate(props.lang, k.lastUsedAt) : t('web.apiKeys.never')}
                    </td>
                    <td>
                      {k.revokedAt ? (
                        t('web.apiKeys.revoked')
                      ) : (
                        <form method="post" action={`/setup/api-keys/${k.id}/revoke`}>
                          <input type="hidden" name="csrf" value={props.csrf} />
                          <input
                            type="hidden"
                            name="installation_id"
                            value={status.installationId}
                          />
                          <button type="submit">{t('web.apiKeys.revoke')}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form method="post" action="/setup/api-keys">
            <input type="hidden" name="csrf" value={props.csrf} />
            <input type="hidden" name="installation_id" value={status.installationId} />
            <p>
              <label>
                {t('web.apiKeys.name')} <input type="text" name="name" required maxlength={80} />
              </label>
            </p>
            <fieldset>
              <legend>{t('web.apiKeys.scopes')}</legend>
              {API_KEY_SCOPES.map((scope) => (
                <label class="choice">
                  <input type="checkbox" name="scopes" value={scope} /> {t(SCOPE_LABELS[scope])}{' '}
                  <code>{scope}</code>
                </label>
              ))}
            </fieldset>
            <p>
              <button type="submit">{t('web.apiKeys.create')}</button>
            </p>
          </form>
        </section>
      ) : null}
      <section>
        <h2>{t('web.setup.failedTitle')}</h2>
        {status.failedDeliveries.length === 0 ? (
          <p>{t('web.setup.noFailed')}</p>
        ) : (
          <ul>
            {status.failedDeliveries.map((d) => (
              <li>
                {t('web.setup.team')}: {d.team} | {t('web.setup.date')}:{' '}
                {formatDate(props.lang, d.at)} | {t('web.setup.error')}: <code>{d.error}</code>
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
