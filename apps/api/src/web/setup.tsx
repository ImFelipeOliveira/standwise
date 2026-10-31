import { type Language, type MessageKey, t as translate } from '@standwise/core';
import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  WEBHOOK_EVENTS,
  type WebhookDeliveryStatus,
  type WebhookEventType,
} from '@standwise/db';
import { type SetupStatus, WEBHOOK_DISABLE_AFTER_FAILURES } from '@standwise/orchestrator';
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

const EVENT_LABELS: Record<WebhookEventType, MessageKey> = {
  'daily.submitted': 'web.webhooks.event.daily_submitted',
  'blocker.opened': 'web.webhooks.event.blocker_opened',
  'digest.sent': 'web.webhooks.event.digest_sent',
};

const DELIVERY_LABELS: Record<WebhookDeliveryStatus, MessageKey> = {
  pending: 'web.webhooks.delivery.pending',
  delivered: 'web.webhooks.delivery.delivered',
  failed: 'web.webhooks.delivery.failed',
};

const FAILURE_KIND_LABELS: Record<
  SetupStatus['teamFailures'][number]['kind'] | SetupStatus['personFailures'][number]['kind'],
  MessageKey
> = {
  digest: 'web.setup.kind.digest',
  late_daily: 'web.setup.kind.late_daily',
  reminder: 'web.setup.kind.reminder',
  blocker_route: 'web.setup.kind.blocker_route',
};

export type NewApiKey = { name: string; key: string };
export type NewWebhook = { url: string; secret: string };

const formatDate = (lang: Language, date: Date) =>
  new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(
    date,
  );

export function SetupPage(props: {
  lang: Language;
  status: SetupStatus;
  csrf: string;
  newKey?: NewApiKey;
  newWebhook?: NewWebhook;
}) {
  const { status } = props;
  const t = (key: MessageKey) => translate(props.lang, key);
  const reasonText = (reason: string) => {
    const key = REASONS[reason];
    return key ? t(key) : '';
  };
  const template = standwiseYmlTemplate(status.login, t('web.template.teamName'), props.lang);
  return (
    <Layout lang={props.lang} title={t('web.setup.title')}>
      <h1>{t('web.setup.heading')}</h1>
      <p>
        {t('web.setup.organization')}: <strong>{status.owner}</strong>
      </p>
      <section>
        <h2>{t('web.setup.configTitle')}</h2>
        {status.config.status === 'configured' ? <p>{t('web.setup.configOk')}</p> : null}
        {status.accessWarning ? (
          <p role="alert">
            {reasonText(status.accessWarning)} {t('web.setup.accessWarning')}
          </p>
        ) : null}
        {status.config.status === 'invalid' ? (
          <>
            <p>{t('web.setup.configInvalid')}</p>
            {status.config.lastValid ? <p>{t('web.setup.configKeepsLastValid')}</p> : null}
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
        ) : null}
        {status.admin ? (
          <a class="button" href={`/connect/slack?installation_id=${status.installationId}`}>
            {t(status.slack.connected ? 'web.slack.reconnect' : 'web.slack.connect')}
          </a>
        ) : (
          <p>{t('web.slack.adminOnly')}</p>
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
      {status.webhooks.manage ? (
        <section>
          <h2>{t('web.webhooks.title')}</h2>
          <p>{t('web.webhooks.description')}</p>
          {props.newWebhook ? (
            <div class="secret" role="alert">
              <strong>
                {translate(props.lang, 'web.webhooks.created', { url: props.newWebhook.url })}
              </strong>
              <p>{t('web.webhooks.copyNow')}</p>
              <p>{t('web.webhooks.disableHint')}</p>
              <pre>{props.newWebhook.secret}</pre>
            </div>
          ) : null}
          {status.webhooks.endpoints.length === 0 ? (
            <p>{t('web.webhooks.none')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('web.webhooks.url')}</th>
                  <th>{t('web.webhooks.events')}</th>
                  <th>{t('web.webhooks.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {status.webhooks.endpoints.map((e) => (
                  <tr>
                    <td>
                      <code>{e.url}</code>
                    </td>
                    <td>
                      {e.events.map((event) => (
                        <code>{event} </code>
                      ))}
                    </td>
                    <td>
                      {e.active
                        ? t('web.webhooks.active')
                        : e.disabledReason === 'failures'
                          ? translate(props.lang, 'web.webhooks.disabledFailures', {
                              count: WEBHOOK_DISABLE_AFTER_FAILURES,
                            })
                          : t('web.webhooks.disabled')}
                    </td>
                    <td>
                      {e.active ? (
                        <>
                          <form method="post" action={`/setup/webhooks/${e.id}/test`}>
                            <input type="hidden" name="csrf" value={props.csrf} />
                            <input
                              type="hidden"
                              name="installation_id"
                              value={status.installationId}
                            />
                            <button type="submit">{t('web.webhooks.sendTest')}</button>
                          </form>
                          <form method="post" action={`/setup/webhooks/${e.id}/disable`}>
                            <input type="hidden" name="csrf" value={props.csrf} />
                            <input
                              type="hidden"
                              name="installation_id"
                              value={status.installationId}
                            />
                            <button type="submit">{t('web.webhooks.disable')}</button>
                          </form>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form method="post" action="/setup/webhooks">
            <input type="hidden" name="csrf" value={props.csrf} />
            <input type="hidden" name="installation_id" value={status.installationId} />
            <p>
              <label>
                {t('web.webhooks.url')}{' '}
                <input
                  type="url"
                  name="url"
                  required
                  maxlength={2048}
                  pattern="https://.*"
                  placeholder="https://"
                />
              </label>
            </p>
            <fieldset>
              <legend>{t('web.webhooks.events')}</legend>
              {WEBHOOK_EVENTS.map((event) => (
                <label class="choice">
                  <input type="checkbox" name="events" value={event} /> {t(EVENT_LABELS[event])}{' '}
                  <code>{event}</code>
                </label>
              ))}
            </fieldset>
            <p>
              <button type="submit">{t('web.webhooks.create')}</button>
            </p>
          </form>
          <h3>{t('web.webhooks.deliveriesTitle')}</h3>
          {status.webhooks.deliveries.length === 0 ? (
            <p>{t('web.webhooks.noDeliveries')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('web.webhooks.createdAt')}</th>
                  <th>{t('web.webhooks.event')}</th>
                  <th>{t('web.webhooks.url')}</th>
                  <th>{t('web.webhooks.status')}</th>
                  <th>{t('web.webhooks.attempts')}</th>
                  <th>{t('web.webhooks.response')}</th>
                </tr>
              </thead>
              <tbody>
                {status.webhooks.deliveries.map((d) => (
                  <tr>
                    <td>{formatDate(props.lang, d.createdAt)}</td>
                    <td>
                      <code>{d.event}</code>
                    </td>
                    <td>
                      <code>{d.endpointUrl}</code>
                    </td>
                    <td>{t(DELIVERY_LABELS[d.status])}</td>
                    <td>{d.attempts}</td>
                    <td>
                      {d.lastStatusCode ?? ''} {d.lastError ? <code>{d.lastError}</code> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
      <section>
        <h2>{t('web.setup.failedTitle')}</h2>
        {status.teamFailures.length === 0 && status.personFailures.length === 0 ? (
          <p>{t('web.setup.noFailed')}</p>
        ) : null}
        {status.teamFailures.length > 0 ? (
          <>
            <h3>{t('web.setup.teamFailures')}</h3>
            <ul>
              {status.teamFailures.map((d) => (
                <li>
                  {t(FAILURE_KIND_LABELS[d.kind])} | {t('web.setup.team')}: {d.team} |{' '}
                  {t('web.setup.date')}: {formatDate(props.lang, d.at)} | {t('web.setup.error')}:{' '}
                  <code>{d.error}</code>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {status.personFailures.length > 0 ? (
          <>
            <h3>{t('web.setup.personFailures')}</h3>
            <ul>
              {status.personFailures.map((d) => (
                <li>
                  {t(FAILURE_KIND_LABELS[d.kind])} | {t('web.setup.error')}: <code>{d.error}</code>{' '}
                  | {t('web.setup.count')}: {d.count} | {t('web.setup.lastAt')}:{' '}
                  {formatDate(props.lang, d.lastAt)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <p>
        {t('web.setup.support')}:{' '}
        <a href={`mailto:${status.supportEmail}`}>{status.supportEmail}</a>
      </p>
    </Layout>
  );
}
