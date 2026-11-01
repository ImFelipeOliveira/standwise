import type { Language } from '@standcast/core';
import { API_KEY_SCOPES, WEBHOOK_EVENTS } from '@standcast/db';
import { type SetupStatus, WEBHOOK_DISABLE_AFTER_FAILURES } from '@standcast/orchestrator';
import {
  DELIVERY_LABELS,
  EVENT_LABELS,
  formatDate,
  SCOPE_LABELS,
  type Translate,
} from './setup-labels';
import { Alert, Badge, type BadgeTone, Card, Code, SubmitButton } from './ui';

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
        <Alert tone="info" role="alert" title={t('web.apiKeys.created', { name: newKey.name })}>
          <p>{t('web.apiKeys.copyNow')}</p>
          <p>{t('web.apiKeys.revokeHint')}</p>
          <p>
            <Code>{newKey.key}</Code>
          </p>
        </Alert>
      ) : null}
      {newWebhook ? (
        <Alert tone="info" role="alert" title={t('web.webhooks.created', { url: newWebhook.url })}>
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
        <ul class="item-list">
          {apiKeys.keys.map((k) => (
            <li class="item">
              <div class="item-head">
                <strong>{k.name}</strong>
                <span class="row">
                  <code>sck_{k.prefix}</code>
                  {k.revokedAt ? <Badge tone="neutral">{t('web.apiKeys.revoked')}</Badge> : null}
                </span>
              </div>
              <p class="small muted item-meta">
                {k.scopes.map((scope) => t(SCOPE_LABELS[scope])).join(', ')}
              </p>
              <p class="small muted item-meta">
                {t('web.apiKeys.createdAt')} {formatDate(props.lang, k.createdAt)} ·{' '}
                {t('web.apiKeys.lastUsed')}:{' '}
                {k.lastUsedAt ? formatDate(props.lang, k.lastUsedAt) : t('web.apiKeys.never')}
              </p>
              {k.revokedAt ? null : (
                <div class="item-actions">
                  <form method="post" action={`/setup/api-keys/${k.id}/revoke`}>
                    <Hidden csrf={props.csrf} installationId={props.installationId} />
                    <SubmitButton variant="danger" size="sm">
                      {t('web.apiKeys.revoke')}
                    </SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
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
  if (endpoint.active) return <Badge tone="success">{t('web.webhooks.active')}</Badge>;
  if (endpoint.disabledReason === 'failures') {
    return (
      <Badge tone="danger">
        {t('web.webhooks.disabledFailures', { count: WEBHOOK_DISABLE_AFTER_FAILURES })}
      </Badge>
    );
  }
  return <Badge tone="neutral">{t('web.webhooks.disabled')}</Badge>;
}

const DELIVERY_TONES: Record<Webhooks['deliveries'][number]['status'], BadgeTone> = {
  pending: 'neutral',
  delivered: 'success',
  failed: 'danger',
};

const lastDelivery = (webhooks: Webhooks, endpointId: string) =>
  webhooks.deliveries
    .filter((d) => d.endpointId === endpointId)
    .reduce<Date | null>(
      (latest, d) => (latest && latest > d.createdAt ? latest : d.createdAt),
      null,
    );

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
        <ul class="item-list">
          {webhooks.endpoints.map((e) => {
            const last = lastDelivery(webhooks, e.id);
            return (
              <li class="item">
                <div class="item-head">
                  <code>{e.url}</code>
                  <EndpointStatus t={t} endpoint={e} />
                </div>
                <p class="small muted item-meta">
                  {e.events.map((event) => t(EVENT_LABELS[event])).join(', ')}
                </p>
                <p class="small muted item-meta">
                  {t('web.webhooks.createdAt')} {formatDate(props.lang, e.createdAt)}
                  {last
                    ? ` · ${t('web.webhooks.lastDelivery')} ${formatDate(props.lang, last)}`
                    : ''}
                </p>
                {e.active ? (
                  <div class="item-actions">
                    <form method="post" action={`/setup/webhooks/${e.id}/test`}>
                      <Hidden csrf={props.csrf} installationId={props.installationId} />
                      <SubmitButton variant="secondary" size="sm">
                        {t('web.webhooks.sendTest')}
                      </SubmitButton>
                    </form>
                    <form method="post" action={`/setup/webhooks/${e.id}/disable`}>
                      <Hidden csrf={props.csrf} installationId={props.installationId} />
                      <SubmitButton variant="danger" size="sm">
                        {t('web.webhooks.disable')}
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
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
        <ul class="item-list">
          {webhooks.deliveries.map((d) => (
            <li class="item">
              <div class="item-head">
                <span class="small muted">{formatDate(props.lang, d.createdAt)}</span>
                <span>
                  <code>{d.event}</code>
                </span>
              </div>
              <div class="row small muted item-meta">
                <Badge tone={DELIVERY_TONES[d.status]}>{t(DELIVERY_LABELS[d.status])}</Badge>
                <span>
                  {t('web.webhooks.attempts')}: {d.attempts}
                </span>
                {d.lastStatusCode !== null || d.lastError ? (
                  <span>
                    {t('web.webhooks.response')}: {d.lastStatusCode ?? ''}{' '}
                    {d.lastError ? <code>{d.lastError}</code> : null}
                  </span>
                ) : null}
              </div>
              <p class="small item-meta">
                <code>{d.endpointUrl}</code>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
