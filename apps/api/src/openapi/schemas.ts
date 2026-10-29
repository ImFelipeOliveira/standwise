import { z } from '@hono/zod-openapi';
import { DailySubmissionSchema as CoreDailySubmission } from '@standwise/core';
import { STATUS } from '../http/errors';

const errorCodes = ['internal', ...Object.keys(STATUS)];

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.enum(errorCodes).openapi({ example: 'unauthorized' }),
      message: z.string().openapi({ example: 'missing or invalid session' }),
      issues: z.array(z.unknown()).optional(),
    }),
  })
  .openapi('Error');

export type ErrorExamples = Record<string, string>;

export function errorResponse(description: string, examples: ErrorExamples) {
  return {
    description,
    content: {
      'application/json': {
        schema: ErrorSchema,
        examples: Object.fromEntries(
          Object.entries(examples).map(([code, message]) => [
            code,
            { summary: code, value: { error: { code, message } } },
          ]),
        ),
      },
    },
  };
}

export const HealthSchema = z
  .object({ ok: z.boolean().openapi({ example: true }) })
  .openapi('Health');

export const MetaSchema = z
  .object({
    githubClientId: z.string().openapi({ example: 'Iv1.0123456789abcdef' }),
    supportEmail: z.string().openapi({ example: 'support@standwise.dev' }),
  })
  .openapi('Meta');

export const SessionRequestSchema = z
  .object({
    githubToken: z.string().min(1).openapi({ example: 'gho_16C7e42F292c6912E7710c838347Ae178B4a' }),
  })
  .openapi('SessionRequest');

export const SESSION_EXAMPLE = {
  token: 'sw_Zm9vYmFyYmF6cXV4',
  login: 'alice',
  orgs: [{ installationId: 11, login: 'acme' }],
};

export const SessionSchema = z
  .object({
    token: z.string().openapi({ example: 'sw_Zm9vYmFyYmF6cXV4' }),
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
    kind: z.enum(['pr_opened', 'pr_merged', 'review', 'commits']),
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
  suggestions: [],
};

export const DraftSchema = z
  .object({
    org: z.string(),
    date: z.string(),
    since: z.string().openapi({ format: 'date-time' }),
    teams: z.array(z.string()),
    activity: z.array(ActivityItemSchema),
    suggestions: z.array(z.string()),
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
