import type { ConfigError, DailySubmission, MessageRef, StandwiseConfig } from '@standwise/core';
import {
  bigint,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export type Provider = 'slack' | 'google-chat' | 'linear' | 'jira';

const installationId = () => bigint('installation_id', { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const installations = pgTable('installations', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').$type<'Organization' | 'User'>().notNull(),
  status: text('status')
    .$type<'unconfigured' | 'configured' | 'invalid'>()
    .notNull()
    .default('unconfigured'),
  config: jsonb('config').$type<StandwiseConfig>(),
  configErrors: jsonb('config_errors').$type<ConfigError[]>(),
  unconfiguredReason: text('unconfigured_reason'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubUserId: bigint('github_user_id', { mode: 'number' }).notNull().unique(),
  login: text('login').notNull(),
  email: text('email'),
});

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
    payload: jsonb('payload').$type<DailySubmission>().notNull(),
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
    kind: text('kind').$type<'digest' | 'late_daily'>().notNull(),
    subject: text('subject').notNull().default(''),
    status: text('status').$type<'pending' | 'sent' | 'failed'>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    ref: jsonb('ref').$type<MessageRef>(),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.installationId, t.teamName, t.date, t.kind, t.subject)],
);

export type InstallationRow = typeof installations.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
