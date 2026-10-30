import { type OpenAPIHono, z } from '@hono/zod-openapi';

const RefSchema = z
  .object({
    kind: z.enum(['pull_request', 'issue', 'commit', 'card']),
    url: z.string().openapi({ example: 'https://github.com/acme/api/pull/42' }),
    title: z.string().optional(),
  })
  .openapi('WebhookRef');

const ItemSchema = z.object({ text: z.string(), ref: RefSchema.optional() }).openapi('WebhookItem');

const InstallationSchema = z
  .object({
    id: z.number().int().openapi({ description: 'GitHub App installation id.' }),
    login: z.string().openapi({ description: 'Organization or account login.' }),
  })
  .openapi('WebhookInstallation');

const envelope = <T extends z.ZodType>(type: string, data: T) =>
  z.object({
    id: z.string().openapi({
      format: 'uuid',
      description: 'Event id. Use it to drop duplicates: retries reuse the same id.',
    }),
    type: z.literal(type),
    created_at: z.string().openapi({ format: 'date-time' }),
    installation: InstallationSchema,
    data,
  });

const INSTALLATION = { id: 12345678, login: 'acme' };
const CREATED_AT = '2026-10-28T12:03:00.000Z';
const BLOCKER = {
  text: 'Waiting for the staging database',
  ref: { kind: 'issue', url: 'https://github.com/acme/infra/issues/7' },
};

export const WEBHOOK_EXAMPLES = {
  'daily.submitted': {
    id: '5f0c3a8e-0f4e-4d1a-9b51-6a4d0f2c9e11',
    type: 'daily.submitted',
    created_at: CREATED_AT,
    installation: INSTALLATION,
    data: {
      id: '7b1c2f0e-5a0b-4a63-9a43-0d2a1f0f9d11',
      login: 'alice',
      date: '2026-10-28',
      teams: ['Alpha'],
      yesterday: [
        {
          text: 'Shipped rate limiting',
          ref: { kind: 'pull_request', url: 'https://github.com/acme/api/pull/42' },
        },
      ],
      today: [{ text: 'Write the integrator guides' }],
      blockers: [BLOCKER],
      replaced: false,
    },
  },
  'blocker.opened': {
    id: '9a3e7c51-2d4b-4f0a-8e6d-1b2c3d4e5f60',
    type: 'blocker.opened',
    created_at: CREATED_AT,
    installation: INSTALLATION,
    data: {
      dailyId: '7b1c2f0e-5a0b-4a63-9a43-0d2a1f0f9d11',
      login: 'alice',
      date: '2026-10-28',
      text: BLOCKER.text,
      ref: BLOCKER.ref,
      teams: ['Alpha'],
    },
  },
  'digest.sent': {
    id: 'c41d2e8f-6b7a-4c3d-9e0f-a1b2c3d4e5f6',
    type: 'digest.sent',
    created_at: '2026-10-28T13:00:04.000Z',
    installation: INSTALLATION,
    data: { team: 'Alpha', date: '2026-10-28', submitted: ['alice'], missing: ['bob'] },
  },
  ping: {
    id: 'e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b',
    type: 'ping',
    created_at: CREATED_AT,
    installation: INSTALLATION,
    data: { endpoint_id: '0d9c8b7a-6f5e-4d3c-8b2a-19f8e7d6c5b4' },
  },
} as const;

const DailySubmittedSchema = envelope(
  'daily.submitted',
  z.object({
    id: z.string().openapi({ format: 'uuid', description: 'Daily id.' }),
    login: z.string().openapi({ description: 'GitHub login of the author.' }),
    date: z.string().openapi({ description: 'Standup date in the team time zone, YYYY-MM-DD.' }),
    teams: z.array(z.string()),
    yesterday: z.array(ItemSchema),
    today: z.array(ItemSchema),
    blockers: z.array(ItemSchema),
    replaced: z
      .boolean()
      .openapi({ description: '`true` when the person resent the daily of the same day.' }),
  }),
).openapi('DailySubmittedEvent');

const BlockerOpenedSchema = envelope(
  'blocker.opened',
  z.object({
    dailyId: z.string().openapi({ format: 'uuid' }),
    login: z.string(),
    date: z.string(),
    text: z.string(),
    ref: RefSchema.optional(),
    teams: z.array(z.string()),
  }),
).openapi('BlockerOpenedEvent');

const DigestSentSchema = envelope(
  'digest.sent',
  z.object({
    team: z.string(),
    date: z.string(),
    submitted: z.array(z.string()).openapi({ description: 'Logins that sent the daily.' }),
    missing: z.array(z.string()).openapi({ description: 'Logins that did not send the daily.' }),
  }),
).openapi('DigestSentEvent');

const PingSchema = envelope(
  'ping',
  z.object({ endpoint_id: z.string().openapi({ format: 'uuid' }) }),
).openapi('PingEvent');

const HeadersSchema = z.object({
  'Standwise-Signature': z.string().openapi({
    description: '`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.',
    example: 't=1793192580,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd',
  }),
  'Standwise-Event': z.string().openapi({ example: 'daily.submitted' }),
  'Standwise-Delivery': z
    .string()
    .openapi({ description: 'Delivery id, unique per endpoint and event.', format: 'uuid' }),
  'User-Agent': z.string().openapi({ example: 'Standwise-Webhooks/1' }),
});

const WEBHOOKS = [
  {
    type: 'daily.submitted',
    schema: DailySubmittedSchema,
    summary: 'A daily was submitted',
    description:
      'Sent every time a person submits the daily, including a resend on the same day (`replaced: true`).',
  },
  {
    type: 'blocker.opened',
    schema: BlockerOpenedSchema,
    summary: 'A new blocker was reported',
    description:
      'Sent once per new blocker. A blocker whose normalized text was already in the previous version of the same daily is not sent again.',
  },
  {
    type: 'digest.sent',
    schema: DigestSentSchema,
    summary: 'A team digest was posted',
    description: 'Sent after the team digest is posted to chat.',
  },
  {
    type: 'ping',
    schema: PingSchema,
    summary: 'Test event',
    description:
      'Sent only when an admin clicks "Send test event" on the setup page. Endpoints cannot subscribe to it.',
  },
] as const;

export function registerWebhooks(app: Pick<OpenAPIHono, 'openAPIRegistry'>): void {
  for (const webhook of WEBHOOKS) {
    app.openAPIRegistry.registerWebhook({
      method: 'post',
      path: webhook.type,
      tags: ['Webhooks'],
      summary: webhook.summary,
      description: webhook.description,
      request: {
        headers: HeadersSchema,
        body: {
          required: true,
          content: {
            'application/json': {
              schema: webhook.schema,
              example: WEBHOOK_EXAMPLES[webhook.type],
            },
          },
        },
      },
      responses: {
        200: {
          description:
            'Any 2xx status acknowledges the delivery. Anything else, a redirect or a timeout after 10 seconds is retried.',
        },
      },
    });
  }
}
