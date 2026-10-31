import type { Language } from '@standwise/core';
import { API_KEY_SCOPES, WEBHOOK_EVENTS } from '@standwise/db';
import { type SetupStatus, WEBHOOK_DISABLE_AFTER_FAILURES } from '@standwise/orchestrator';
import {
  DELIVERY_LABELS,
  EVENT_LABELS,
  formatDate,
  SCOPE_LABELS,
  type Translate,
} from './setup-labels';
import { Alert, Card, Code, ScrollTable, SubmitButton } from './ui';

export type NewApiKey = { name: string; key: string };
export type NewWebhook = { url: string; secret: string };

type ApiKeys = Extract<SetupStatus['apiKeys'], { manage: true }>;
type Webhooks = Extract<SetupStatus['webhooks'], { manage: true }>;

function Hidden(props: { csrf: string; installationId: number }) {
  return (
    <>
      <input type="hidden" name="csrf" value={props.csrf} />
      <input type="hidden" name="installation_id" value={props.installationId} />
    </>
  );
}

export function SecretAlerts(props: { t: Translate; newKey?: NewApiKey; newWebhook?: NewWebhook }) {
  const { t, newKey, newWebhook } = props;
  return (
    <>
      {newKey ? (
        <Alert tone="info" title={t('web.apiKeys.created', { name: newKey.name })}>
          <p>{t('web.apiKeys.copyNow')}</p>
          <p>{t('web.apiKeys.revokeHint')}</p>
          <p>
            <Code>{newKey.key}</Code>
          </p>
        </Alert>
      ) : null}
      {newWebhook ? (
        <Alert tone="info" title={t('web.webhooks.created', { url: newWebhook.url })}>
          <p>{t('web.webhooks.copyNow')}</p>
          <p>{t('web.webhooks.disableHint')}</p>
          <p>
            <Code>{newWebhook.secret}</Code>
          </p>
        </Alert>
      ) : null}
    </>
  );
}

export function ApiKeysCard(props: {
  t: Translate;
  lang: Language;
  csrf: string;
  installationId: number;
  apiKeys: ApiKeys;
}) {
  const { t, apiKeys } = props;
  return (
    <Card id="api-keys">
      <div class="card-head">
        <h2>{t('web.apiKeys.title')}</h2>
        <a href="#new-api-key" class="small">
          {t('web.apiKeys.new')}
        </a>
      </div>
      <p class="small muted">{t('web.apiKeys.description')}</p>
      {apiKeys.keys.length === 0 ? (
        <p class="small">{t('web.apiKeys.none')}</p>
      ) : (
        <ScrollTable>
          <table class="table-compact">
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
              {apiKeys.keys.map((k) => (
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
                        <Hidden csrf={props.csrf} installationId={props.installationId} />
                        <SubmitButton variant="danger">{t('web.apiKeys.revoke')}</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
      <div id="new-api-key">
        <form method="post" action="/setup/api-keys">
          <Hidden csrf={props.csrf} installationId={props.installationId} />
          <p>
            <label class="field">
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
          <SubmitButton>{t('web.apiKeys.create')}</SubmitButton>
        </form>
      </div>
    </Card>
  );
}

function EndpointStatus(props: { t: Translate; endpoint: Webhooks['endpoints'][number] }) {
  const { t, endpoint } = props;
  if (endpoint.active) return <>{t('web.webhooks.active')}</>;
  if (endpoint.disabledReason === 'failures') {
    return <>{t('web.webhooks.disabledFailures', { count: WEBHOOK_DISABLE_AFTER_FAILURES })}</>;
  }
  return <>{t('web.webhooks.disabled')}</>;
}

export function WebhooksCard(props: {
  t: Translate;
  lang: Language;
  csrf: string;
  installationId: number;
  webhooks: Webhooks;
}) {
  const { t, webhooks } = props;
  return (
    <Card id="webhooks">
      <div class="card-head">
        <h2>{t('web.webhooks.title')}</h2>
        <a href="#new-webhook" class="small">
          {t('web.webhooks.new')}
        </a>
      </div>
      <p class="small muted">{t('web.webhooks.description')}</p>
      {webhooks.endpoints.length === 0 ? (
        <p class="small">{t('web.webhooks.none')}</p>
      ) : (
        <ScrollTable>
          <table class="table-compact">
            <thead>
              <tr>
                <th>{t('web.webhooks.url')}</th>
                <th>{t('web.webhooks.events')}</th>
                <th>{t('web.webhooks.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {webhooks.endpoints.map((e) => (
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
                    <EndpointStatus t={t} endpoint={e} />
                  </td>
                  <td>
                    {e.active ? (
                      <div class="row">
                        <form method="post" action={`/setup/webhooks/${e.id}/test`}>
                          <Hidden csrf={props.csrf} installationId={props.installationId} />
                          <SubmitButton variant="secondary">
                            {t('web.webhooks.sendTest')}
                          </SubmitButton>
                        </form>
                        <form method="post" action={`/setup/webhooks/${e.id}/disable`}>
                          <Hidden csrf={props.csrf} installationId={props.installationId} />
                          <SubmitButton variant="danger">{t('web.webhooks.disable')}</SubmitButton>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
      <div id="new-webhook">
        <form method="post" action="/setup/webhooks">
          <Hidden csrf={props.csrf} installationId={props.installationId} />
          <p>
            <label class="field">
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
          <SubmitButton>{t('web.webhooks.create')}</SubmitButton>
        </form>
      </div>
      <h3>{t('web.webhooks.deliveriesTitle')}</h3>
      {webhooks.deliveries.length === 0 ? (
        <p class="small">{t('web.webhooks.noDeliveries')}</p>
      ) : (
        <ScrollTable>
          <table class="table-compact">
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
              {webhooks.deliveries.map((d) => (
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
        </ScrollTable>
      )}
    </Card>
  );
}
