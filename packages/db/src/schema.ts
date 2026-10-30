import type {
  ConfigError,
  MessageRef,
  Ref,
  SignalKind,
  StandwiseConfig,
  StoredDaily,
} from '@standwise/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type Provider = 'slack' | 'google-chat' | 'linear' | 'jira';

const installationId = () => bigint('installation_id', { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const installations = pgTable('installations', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').$type<'Organization' | 'User'>().notNull(),
  accountId: bigint('account_id', { mode: 'number' }),
  status: text('status')
    .$type<'unconfigured' | 'configured' | 'invalid'>()
    .notNull()
    .default('unconfigured'),
  config: jsonb('config').$type<StandwiseConfig>(),
  configErrors: jsonb('config_errors').$type<ConfigError[]>(),
  unconfiguredReason: text('unconfigured_reason'),
  accessWarning: text('access_warning'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    githubUserId: bigint('github_user_id', { mode: 'number' }).notNull().unique(),
    login: text('login').notNull(),
    email: text('email'),
  },
  (t) => [uniqueIndex('members_login_lower_idx').on(sql`lower(${t.login})`)],
);

const installationRef = () =>
  installationId()
    .notNull()
    .references(() => installations.id, { onDelete: 'cascade' });
const memberRef = (name = 'member_id') =>
  uuid(name)
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' });

export const memberInstallations = pgTable(
  'member_installations',
  { memberId: memberRef(), installationId: installationRef() },
  (t) => [primaryKey({ columns: [t.memberId, t.installationId] })],
);

export const memberIdentities = pgTable(
  'member_identities',
  {
    installationId: installationRef(),
    memberId: memberRef(),
    provider: text('provider').$type<Provider>().notNull(),
    externalId: text('external_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.installationId, t.memberId, t.provider] })],
);

export const connections = pgTable(
  'connections',
  {
    installationId: installationRef(),
    provider: text('provider').$type<Provider>().notNull(),
    externalId: text('external_id').notNull(),
    externalName: text('external_name'),
    secretCiphertext: text('secret_ciphertext').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.installationId, t.provider] })],
);

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  memberId: memberRef(),
  kind: text('kind').$type<'cli' | 'web'>().notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dailies = pgTable(
  'dailies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: installationRef(),
    memberId: memberRef(),
    date: date('date', { mode: 'string' }).notNull(),
    payload: jsonb('payload').$type<StoredDaily>().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique().on(t.installationId, t.memberId, t.date)],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: installationRef(),
    teamName: text('team_name').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind')
      .$type<'digest' | 'late_daily' | 'reminder' | 'blocker_route' | 'suggestion_dm'>()
      .notNull(),
    subject: text('subject').notNull().default(''),
    status: text('status').$type<'pending' | 'sent' | 'failed'>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    ref: jsonb('ref').$type<MessageRef>(),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.installationId, t.teamName, t.date, t.kind, t.subject)],
);

export type SuggestionState = 'pending' | 'confirmed' | 'ignored' | 'resolved';

export const suggestions = pgTable(
  'suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: installationRef(),
    memberId: memberRef(),
    kind: text('kind').$type<SignalKind>().notNull(),
    ref: jsonb('ref').$type<Ref>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    state: text('state').$type<SuggestionState>().notNull().default('pending'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [unique().on(t.installationId, t.memberId, t.fingerprint)],
);

export const API_KEY_SCOPES = [
  'teams:read',
  'dailies:read',
  'digests:read',
  'blockers:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: installationRef(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull().unique(),
    scopes: text('scopes').array().$type<ApiKeyScope[]>().notNull(),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_keys_installation_idx').on(t.installationId)],
);

export const WEBHOOK_EVENTS = ['daily.submitted', 'blocker.opened', 'digest.sent'] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
export type WebhookDeliveryEvent = WebhookEventType | 'ping';
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';
export type WebhookDisabledReason = 'manual' | 'failures';

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: installationRef(),
    url: text('url').notNull(),
    secretCiphertext: text('secret_ciphertext').notNull(),
    events: text('events').array().$type<WebhookEventType[]>().notNull(),
    active: boolean('active').notNull().default(true),
    disabledReason: text('disabled_reason').$type<WebhookDisabledReason>(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_endpoints_installation_idx').on(t.installationId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: text('event').$type<WebhookDeliveryEvent>().notNull(),
    eventId: uuid('event_id').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.endpointId, t.eventId),
    index('webhook_deliveries_endpoint_created_idx').on(t.endpointId, t.createdAt),
    index('webhook_deliveries_pending_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);

export type InstallationRow = typeof installations.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limits_window_start_idx').on(t.windowStart),
  ],
);
