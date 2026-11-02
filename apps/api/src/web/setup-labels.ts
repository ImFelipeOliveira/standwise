import { type Language, type MessageKey, t as translate } from '@standcast/core';
import type { ApiKeyScope, WebhookDeliveryStatus, WebhookEventType } from '@standcast/db';
import type { SetupStatus, TrackerNotice } from '@standcast/orchestrator';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const translator =
  (lang: Language): Translate =>
  (key, vars) =>
    translate(lang, key, vars);

export const REASONS: Record<string, MessageKey> = {
  no_repo: 'web.setup.reason.no_repo',
  no_file: 'web.setup.reason.no_file',
  no_access: 'web.setup.reason.no_access',
};

export const reasonText = (t: Translate, reason: string) => {
  const key = REASONS[reason];
  return key ? t(key) : '';
};

export const SCOPE_LABELS: Record<ApiKeyScope, MessageKey> = {
  'teams:read': 'web.apiKeys.scope.teams_read',
  'dailies:read': 'web.apiKeys.scope.dailies_read',
  'digests:read': 'web.apiKeys.scope.digests_read',
  'blockers:read': 'web.apiKeys.scope.blockers_read',
};

export const EVENT_LABELS: Record<WebhookEventType, MessageKey> = {
  'daily.submitted': 'web.webhooks.event.daily_submitted',
  'blocker.opened': 'web.webhooks.event.blocker_opened',
  'digest.sent': 'web.webhooks.event.digest_sent',
};

export const DELIVERY_LABELS: Record<WebhookDeliveryStatus, MessageKey> = {
  pending: 'web.webhooks.delivery.pending',
  delivered: 'web.webhooks.delivery.delivered',
  failed: 'web.webhooks.delivery.failed',
};

export const FAILURE_KIND_LABELS: Record<
  SetupStatus['teamFailures'][number]['kind'] | SetupStatus['personFailures'][number]['kind'],
  MessageKey
> = {
  digest: 'web.setup.kind.digest',
  late_daily: 'web.setup.kind.late_daily',
  reminder: 'web.setup.kind.reminder',
  blocker_route: 'web.setup.kind.blocker_route',
};

export const TRACKER_NOTICES: Record<TrackerNotice, MessageKey> = {
  linear_not_connected: 'setup.tracker.notConnected',
  jira_coming_soon: 'setup.tracker.jiraComingSoon',
};

export const TEAM_NOTICES: Record<SetupStatus['teamNotices'][number]['kind'], MessageKey> = {
  missing: 'setup.teams.missing',
  truncated: 'setup.teams.truncated',
  channel_not_found: 'setup.teams.channelNotFound',
  channel_not_member: 'setup.teams.channelNotMember',
};

export const formatDate = (lang: Language, date: Date) =>
  new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(
    date,
  );
