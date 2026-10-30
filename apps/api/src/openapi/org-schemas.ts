import { z } from '@hono/zod-openapi';

const nextCursor = () =>
  z.string().nullable().openapi({
    description: 'Pass it as `cursor` to get the next page. `null` on the last page.',
    example: null,
  });

const RefSchema = z
  .object({
    kind: z.enum(['pull_request', 'issue', 'commit', 'card']).openapi({ example: 'pull_request' }),
    url: z.string().openapi({ example: 'https://github.com/acme/api/pull/42' }),
    title: z.string().nullable().openapi({ example: 'Add rate limiting' }),
  })
  .openapi('OrgRef');

const ItemSchema = z
  .object({
    text: z.string().openapi({ example: 'Shipped rate limiting' }),
    ref: RefSchema.nullable(),
  })
  .openapi('OrgItem');

export const ORG_TEAM_EXAMPLE = {
  name: 'Alpha',
  timezone: 'America/Sao_Paulo',
  workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  remindAt: '09:00',
  digestAt: '10:00',
  memberLogins: ['alice', 'bob'],
};

export const OrgTeamSchema = z
  .object({
    name: z.string(),
    timezone: z.string().openapi({ description: 'IANA time zone.' }),
    workdays: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])),
    remindAt: z.string().openapi({ description: 'Local time, HH:MM.' }),
    digestAt: z.string().openapi({ description: 'Local time, HH:MM.' }),
    memberLogins: z.array(z.string()).openapi({ description: 'Lowercase GitHub logins.' }),
  })
  .openapi('OrgTeam', { example: ORG_TEAM_EXAMPLE });

export const ORG_TEAMS_EXAMPLE = { data: [ORG_TEAM_EXAMPLE], next_cursor: null };

export const OrgTeamListSchema = z
  .object({ data: z.array(OrgTeamSchema), next_cursor: nextCursor() })
  .openapi('OrgTeamList', { example: ORG_TEAMS_EXAMPLE });

export const ORG_DAILY_EXAMPLE = {
  id: '7b1c2f0e-5a0b-4a63-9a43-0d2a1f0f9d11',
  login: 'alice',
  date: '2026-10-28',
  submittedAt: '2026-10-28T12:03:00.000Z',
  teams: ['Alpha'],
  yesterday: [
    {
      text: 'Shipped rate limiting',
      ref: { kind: 'pull_request', url: 'https://github.com/acme/api/pull/42', title: null },
    },
  ],
  today: [{ text: 'Write the integrator guides', ref: null }],
  blockers: [{ text: 'Waiting for the staging database', ref: null }],
};

export const OrgDailySchema = z
  .object({
    id: z.string().openapi({ format: 'uuid' }),
    login: z.string().openapi({ description: 'GitHub login of the author.' }),
    date: z.string().openapi({ description: 'Standup date in the team time zone, YYYY-MM-DD.' }),
    submittedAt: z.string().openapi({ format: 'date-time' }),
    teams: z
      .array(z.string())
      .openapi({ description: 'Teams the author belongs to in the current configuration.' }),
    yesterday: z.array(ItemSchema),
    today: z.array(ItemSchema),
    blockers: z.array(ItemSchema),
  })
  .openapi('OrgDaily', { example: ORG_DAILY_EXAMPLE });

export const ORG_DAILIES_EXAMPLE = {
  data: [ORG_DAILY_EXAMPLE],
  next_cursor:
    'eyJkYXRlIjoiMjAyNi0xMC0yOCIsImlkIjoiN2IxYzJmMGUtNWEwYi00YTYzLTlhNDMtMGQyYTFmMGY5ZDExIn0',
};

export const OrgDailyListSchema = z
  .object({ data: z.array(OrgDailySchema), next_cursor: nextCursor() })
  .openapi('OrgDailyList', { example: ORG_DAILIES_EXAMPLE });

export const ORG_DIGEST_EXAMPLE = {
  team: 'Alpha',
  date: '2026-10-28',
  status: 'sent',
  sentAt: '2026-10-28T13:00:04.000Z',
  missing: ['bob'],
};

export const OrgDigestSchema = z
  .object({
    team: z.string(),
    date: z.string().openapi({ description: 'Standup date, YYYY-MM-DD.' }),
    status: z.enum(['pending', 'sent', 'failed']),
    sentAt: z.string().nullable().openapi({ format: 'date-time' }),
    missing: z
      .array(z.string())
      .openapi({ description: 'Team members who had not sent the daily for that date.' }),
  })
  .openapi('OrgDigest', { example: ORG_DIGEST_EXAMPLE });

export const ORG_DIGESTS_EXAMPLE = { data: [ORG_DIGEST_EXAMPLE], next_cursor: null };

export const OrgDigestListSchema = z
  .object({ data: z.array(OrgDigestSchema), next_cursor: nextCursor() })
  .openapi('OrgDigestList', { example: ORG_DIGESTS_EXAMPLE });

export const ORG_BLOCKER_EXAMPLE = {
  text: 'Waiting for the staging database',
  ref: null,
  author: 'alice',
  date: '2026-10-28',
  teams: ['Alpha'],
};

export const OrgBlockerSchema = z
  .object({
    text: z.string(),
    ref: RefSchema.nullable(),
    author: z.string(),
    date: z.string().openapi({ description: 'Standup date, YYYY-MM-DD.' }),
    teams: z.array(z.string()),
  })
  .openapi('OrgBlocker', { example: ORG_BLOCKER_EXAMPLE });

export const ORG_BLOCKERS_EXAMPLE = { data: [ORG_BLOCKER_EXAMPLE], next_cursor: null };

export const OrgBlockerListSchema = z
  .object({ data: z.array(OrgBlockerSchema), next_cursor: nextCursor() })
  .openapi('OrgBlockerList', { example: ORG_BLOCKERS_EXAMPLE });
