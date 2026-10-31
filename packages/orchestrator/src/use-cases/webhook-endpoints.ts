import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import {
  type Db,
  deactivateWebhookEndpoint,
  getWebhookEndpoint,
  insertWebhookEndpoint,
  listInstallationWebhookEndpoints,
  listRecentWebhookDeliveries,
  type MemberRow,
  WEBHOOK_EVENTS,
  type WebhookDeliverySummary,
  type WebhookEndpointSummary,
  type WebhookEventType,
} from '@standwise/db';
import type { Deps } from '../deps';
import { isPublicAddress } from '../safe-fetch';
import { enqueueEnvelope } from './emit-event';
import { DomainError } from './errors';
import type { MembershipCheck } from './org-context';
import { isUuid } from './pagination';
import { requireAdmin } from './require-admin';

const MAX_URL_LENGTH = 2048;
const MAX_ACTIVE_ENDPOINTS = 10;
const RECENT_DELIVERIES = 20;
const SECRET_PREFIX = 'whsec_';

export type CreateWebhookEndpointInput = {
  installationId: number;
  url: string;
  events: WebhookEventType[];
};

export type WebhookOverview = {
  endpoints: WebhookEndpointSummary[];
  deliveries: WebhookDeliverySummary[];
};

const invalid = (message: string) => new DomainError('invalid_request', message);

function validateEndpointUrl(raw: string): string {
  if (raw.length > MAX_URL_LENGTH)
    throw invalid(`url must have at most ${MAX_URL_LENGTH} characters`);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw invalid('url is not valid');
  }
  if (url.protocol !== 'https:') throw invalid('url must use https');
  if (url.username || url.password) throw invalid('url must not contain credentials');
  if (url.port !== '') throw invalid('url must use the default https port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw invalid('url must point to a public address');
  } else if (!host.includes('.') || host.endsWith('.localhost')) {
    throw invalid('url must use a public host name');
  }
  return url.href;
}

function validateEvents(events: WebhookEventType[]): WebhookEventType[] {
  const unique = [...new Set(events)];
  if (unique.length === 0 || unique.some((e) => !WEBHOOK_EVENTS.includes(e))) {
    throw invalid('events must be a non-empty list of known events');
  }
  return unique;
}

export async function loadWebhookOverview(
  db: Db,
  installationId: number,
): Promise<WebhookOverview> {
  const [endpoints, deliveries] = await Promise.all([
    listInstallationWebhookEndpoints(db, installationId),
    listRecentWebhookDeliveries(db, installationId, RECENT_DELIVERIES),
  ]);
  return { endpoints, deliveries };
}

export async function createWebhookEndpoint(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: CreateWebhookEndpointInput,
): Promise<{ id: string; secret: string }> {
  await requireAdmin(deps, isMember, member, input.installationId);
  const url = validateEndpointUrl(input.url);
  const events = validateEvents(input.events);
  const existing = await listInstallationWebhookEndpoints(deps.db, input.installationId);
  if (existing.filter((e) => e.active).length >= MAX_ACTIVE_ENDPOINTS) {
    throw invalid(`at most ${MAX_ACTIVE_ENDPOINTS} active endpoints per organization`);
  }
  const secret = `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
  const { id } = await insertWebhookEndpoint(
    deps.db,
    { installationId: input.installationId, url, events, secret },
    deps.encryptionKey,
  );
  return { id, secret };
}

export async function disableWebhookEndpoint(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number,
  endpointId: string,
): Promise<void> {
  await requireAdmin(deps, isMember, member, installationId);
  if (
    !isUuid(endpointId) ||
    !(await deactivateWebhookEndpoint(deps.db, installationId, endpointId, 'manual'))
  ) {
    throw new DomainError('not_found', 'webhook endpoint not found');
  }
}

export async function sendTestEvent(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number,
  endpointId: string,
): Promise<{ deliveryId: string }> {
  await requireAdmin(deps, isMember, member, installationId);
  const endpoint = isUuid(endpointId)
    ? await getWebhookEndpoint(deps.db, installationId, endpointId)
    : null;
  if (!endpoint?.active) throw new DomainError('not_found', 'webhook endpoint not found');
  const [deliveryId] = await enqueueEnvelope(
    deps,
    installationId,
    { type: 'ping', data: { endpoint_id: endpoint.id } },
    [endpoint.id],
  );
  if (!deliveryId) throw new Error('test event was not created');
  return { deliveryId };
}
