import { z } from '@hono/zod-openapi';
import { DailySubmissionSchema as CoreDailySubmission } from '@standcast/core';
import { STATUS } from '../http/errors';

const errorCodes = ['internal', ...Object.keys(STATUS)];

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.enum(errorCodes).openapi({ example: 'unauthorized' }),
      message: z.string().openapi({ example: 'missing or invalid session' }),
      issues: z.array(z.unknown()).optional(),
      required_scope: z.string().optional().openapi({ example: 'dailies:read' }),
    }),
  })
  .openapi('Error');

export type ErrorExamples = Record<string, string>;

export function errorResponse(
  description: string,
  examples: ErrorExamples,
  extra: Record<string, unknown> = {},
) {
  return {
    description,
    content: {
      'application/json': {
        schema: ErrorSchema,
        examples: Object.fromEntries(
          Object.entries(examples).map(([code, message]) => [
            code,
            { summary: code, value: { error: { code, message, ...extra } } },
          ]),
        ),
      },
    },
  };
}

export const RATE_LIMITED = errorResponse('Rate limit exceeded. Wait `Retry-After` seconds.', {
  rate_limited: 'rate limit exceeded',
});

export const rateHeaders = {
  'RateLimit-Limit': { description: 'Requests allowed per window.', schema: { type: 'integer' } },
  'RateLimit-Remaining': {
    description: 'Requests left in the window.',
    schema: { type: 'integer' },
  },
  'RateLimit-Reset': {
    description: 'Seconds until the window resets.',
    schema: { type: 'integer' },
  },
} as const;

export const HealthSchema = z
  .object({ ok: z.boolean().openapi({ example: true }) })
  .openapi('Health');

export const MetaSchema = z
  .object({
    githubClientId: z.string().openapi({ example: 'Iv1.0123456789abcdef' }),
    supportEmail: z.string().openapi({ example: 'support.standcast@usefachada.dev' }),
  })
  .openapi('Meta');

export const SessionRequestSchema = z
  .object({
    githubToken: z.string().min(1).openapi({ example: 'gho_16C7e42F292c6912E7710c838347Ae178B4a' }),
  })
  .openapi('SessionRequest');

export const SESSION_EXAMPLE = {
  token: 'sc_Zm9vYmFyYmF6cXV4',
  login: 'alice',
  orgs: [{ installationId: 11, login: 'acme' }],
};

export const SessionSchema = z
  .object({
    token: z.string().openapi({ example: 'sc_Zm9vYmFyYmF6cXV4' }),
    login: z.string().openapi({ example: 'alice' }),
    orgs: z.array(
      z.object({
        installationId: z.number().int().openapi({ example: 11 }),
        login: z.string().openapi({ example: 'acme' }),
      }),
    ),
  })
  .openapi('Session', { example: SESSION_EXAMPLE });

export const ActivityItemSchema = z
  .object({
    kind: z.enum(['pr_opened', 'pr_merged', 'review', 'commits', 'card_started', 'card_done']),
    title: z.string(),
    url: z.string(),
    repo: z.string(),
    at: z.string().openapi({ format: 'date-time' }),
    count: z.number().int().optional(),
  })
  .openapi('ActivityItem', {
    example: {
      kind: 'pr_merged',
      title: 'Add rate limiting',
      url: 'https://github.com/acme/api/pull/42',
      repo: 'acme/api',
      at: '2026-10-27T18:30:00.000Z',
    },
  });

export const DraftSuggestionSchema = z
  .object({
    id: z.string().openapi({ format: 'uuid' }),
    kind: z.enum(['pr_no_review', 'ci_failing', 'card_stale']),
    ref: z.object({
      kind: z.enum(['pull_request', 'issue', 'commit', 'card']),
      url: z.string(),
      title: z.string().optional(),
    }),
    since: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('DraftSuggestion', {
    example: {
      id: '5f0c2a8e-3b1d-4c7e-9a2f-1d6b8e4c0a17',
      kind: 'pr_no_review',
      ref: {
        kind: 'pull_request',
        url: 'https://github.com/acme/api/pull/40',
        title: 'Retry webhook deliveries',
      },
      since: '2026-10-27T12:00:00.000Z',
    },
  });

export const SuggestionDecisionSchema = z
  .object({
    org: z.string().min(1).openapi({ description: 'Login of the organization.', example: 'acme' }),
    decision: z.enum(['confirmed', 'ignored']).openapi({ example: 'ignored' }),
  })
  .openapi('SuggestionDecision');

export const DRAFT_EXAMPLE = {
  org: 'acme',
  date: '2026-10-28',
  since: '2026-10-27T03:00:00.000Z',
  teams: ['Alpha'],
  activity: [
    {
      kind: 'pr_merged' as const,
      title: 'Add rate limiting',
      url: 'https://github.com/acme/api/pull/42',
      repo: 'acme/api',
      at: '2026-10-27T18:30:00.000Z',
    },
  ],
  suggestions: [
    {
      id: '5f0c2a8e-3b1d-4c7e-9a2f-1d6b8e4c0a17',
      kind: 'pr_no_review' as const,
      ref: {
        kind: 'pull_request' as const,
        url: 'https://github.com/acme/api/pull/40',
        title: 'Retry webhook deliveries',
      },
      since: '2026-10-27T12:00:00.000Z',
    },
  ],
};

export const DraftSchema = z
  .object({
    org: z.string(),
    date: z.string(),
    since: z.string().openapi({ format: 'date-time' }),
    teams: z.array(z.string()),
    activity: z.array(ActivityItemSchema),
    suggestions: z.array(DraftSuggestionSchema),
  })
  .openapi('Draft', { example: DRAFT_EXAMPLE });

export const DAILY_EXAMPLE = {
  org: 'acme',
  yesterday: [
    {
      text: 'Shipped rate limiting',
      ref: { kind: 'pull_request' as const, url: 'https://github.com/acme/api/pull/42' },
    },
  ],
  today: [{ text: 'Write the integrator guides' }],
  blockers: [],
};

export const DailySubmissionSchema = CoreDailySubmission.meta({
  id: 'DailySubmission',
  example: DAILY_EXAMPLE,
});

export const SubmitResultSchema = z
  .object({
    date: z.string(),
    teams: z.array(z.string()),
    late: z.boolean(),
  })
  .openapi('SubmitResult', { example: { date: '2026-10-28', teams: ['Alpha'], late: false } });

export const TodaySchema = z
  .object({
    org: z.string(),
    date: z.string(),
    teams: z.array(z.string()),
  })
  .openapi('Today', { example: { org: 'acme', date: '2026-10-28', teams: ['Alpha'] } });
