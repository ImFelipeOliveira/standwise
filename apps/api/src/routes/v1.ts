import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createMembershipCheck,
  type Deps,
  DomainError,
  getDraft,
  startSession,
  submitDaily,
} from '@standwise/orchestrator';
import { HTTPException } from 'hono/http-exception';
import { onError } from '../http/errors';
import {
  type GetClientIp,
  IP_LIMIT,
  ipRateLimit,
  SESSION_START_LIMIT,
  subjectRateLimit,
} from '../middleware/rate-limit';
import { type SessionEnv, sessionAuth } from '../middleware/session-auth';
import { sessionScheme } from '../openapi/document';
import {
  DAILY_EXAMPLE,
  DailySubmissionSchema,
  DRAFT_EXAMPLE,
  DraftSchema,
  errorResponse,
  MetaSchema,
  SESSION_EXAMPLE,
  SessionRequestSchema,
  SessionSchema,
  SubmitResultSchema,
} from '../openapi/schemas';

type Env = SessionEnv;

export type V1Options = { getClientIp: GetClientIp };

const RATE_LIMITED = errorResponse('Rate limit exceeded. Wait `Retry-After` seconds.', {
  rate_limited: 'rate limit exceeded',
});
const UNAUTHORIZED = errorResponse('Missing, invalid or expired session.', {
  unauthorized: 'missing or invalid session',
});
const ORG_ERRORS = {
  404: errorResponse('The organization was not found.', {
    org_not_found: 'organization not found',
  }),
  409: errorResponse('The organization is not ready to use.', {
    org_not_configured: 'organization has no valid standwise.yml',
    installation_pending: 'installation is still being processed',
  }),
};

const rateHeaders = {
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

const meta = createRoute({
  method: 'get',
  path: '/v1/meta',
  tags: ['Meta'],
  summary: 'Public client metadata',
  description:
    'Returns the GitHub OAuth client id and the support email, so the CLI can start a login.\n\nRetorna o client id do OAuth do GitHub e o e-mail de suporte, para a CLI iniciar o login.',
  responses: {
    200: {
      description: 'Client metadata.',
      content: {
        'application/json': {
          schema: MetaSchema,
          example: {
            githubClientId: 'Iv1.0123456789abcdef',
            supportEmail: 'support@standwise.dev',
          },
        },
      },
    },
  },
});

const sessions = createRoute({
  method: 'post',
  path: '/v1/sessions',
  tags: ['Session'],
  summary: 'Start a CLI session',
  description:
    'Exchanges a GitHub user token for a Standwise session token (`sw_`). Limited to 10 requests per minute per IP address.\n\nTroca um token de usuário do GitHub por um token de sessão do Standwise (`sw_`). Limitado a 10 requisições por minuto por IP.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: SessionRequestSchema,
          example: { githubToken: 'gho_16C7e42F292c6912E7710c838347Ae178B4a' },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Session created.',
      headers: rateHeaders,
      content: { 'application/json': { schema: SessionSchema, example: SESSION_EXAMPLE } },
    },
    401: errorResponse('The GitHub token is invalid or expired.', {
      unauthorized: 'GitHub token invalid or expired',
    }),
    422: errorResponse('The body is not valid.', { invalid_request: 'githubToken is required' }),
    429: RATE_LIMITED,
  },
});

const draft = createRoute({
  method: 'get',
  path: '/v1/draft',
  tags: ['Daily'],
  summary: 'Get the draft for today',
  description:
    "Builds the draft of yesterday's work from the person's GitHub activity. `org` is optional when the person belongs to a single organization.\n\nMonta o rascunho do que a pessoa fez ontem a partir da atividade no GitHub. `org` é opcional quando a pessoa pertence a uma única organização.",
  security: [{ session: [] }],
  request: { query: z.object({ org: z.string().optional().openapi({ example: 'acme' }) }) },
  responses: {
    200: {
      description: 'The draft.',
      headers: rateHeaders,
      content: { 'application/json': { schema: DraftSchema, example: DRAFT_EXAMPLE } },
    },
    401: UNAUTHORIZED,
    403: errorResponse('The person has no access to the organization.', {
      forbidden: 'not a member of this organization',
    }),
    404: ORG_ERRORS[404],
    409: ORG_ERRORS[409],
    422: errorResponse('The request or the person is not valid for this organization.', {
      invalid_request: 'org is required',
      not_in_team: 'you are not in any team of this organization',
    }),
    429: RATE_LIMITED,
  },
});

const dailies = createRoute({
  method: 'post',
  path: '/v1/dailies',
  tags: ['Daily'],
  summary: 'Submit the daily',
  description:
    'Submits the confirmed daily. Sending again on the same day replaces the previous one. If the digest was already posted, the daily is posted as a thread reply.\n\nEnvia a daily confirmada. Reenviar no mesmo dia substitui a anterior. Se o consolidado já foi publicado, a daily vai como resposta na thread.',
  security: [{ session: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: DailySubmissionSchema,
          example: DAILY_EXAMPLE,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The daily was stored.',
      headers: rateHeaders,
      content: {
        'application/json': {
          schema: SubmitResultSchema,
          example: { date: '2026-10-28', teams: ['Alpha'], late: false },
        },
      },
    },
    401: UNAUTHORIZED,
    403: errorResponse('The person has no access to the organization.', {
      forbidden: 'not a member of this organization',
    }),
    404: ORG_ERRORS[404],
    409: ORG_ERRORS[409],
    422: errorResponse('The daily is not valid, or the person is in no team.', {
      invalid_daily: 'invalid daily',
      not_in_team: 'you are not in any team of this organization',
    }),
    429: RATE_LIMITED,
  },
});

const BODY_ERRORS: Record<string, DomainError> = {
  '/v1/sessions': new DomainError('invalid_request', 'githubToken is required'),
  '/v1/dailies': new DomainError('invalid_daily', 'invalid daily'),
};

function bodyError(error: Error, path: string): Error {
  const mapped = BODY_ERRORS[path];
  if (error instanceof HTTPException && (error.status === 400 || error.status === 415) && mapped) {
    return new DomainError(mapped.code, mapped.message);
  }
  return error;
}

export function v1Routes(deps: Deps, options: V1Options): OpenAPIHono<Env> {
  const app = new OpenAPIHono<Env>();
  const isMember = createMembershipCheck(deps);
  app.openAPIRegistry.registerComponent('securitySchemes', 'session', sessionScheme());

  app.use('/v1/*', ipRateLimit(deps, options.getClientIp, 'api', IP_LIMIT));
  app.use('/v1/sessions', ipRateLimit(deps, options.getClientIp, 'sessions', SESSION_START_LIMIT));
  for (const path of ['/v1/draft', '/v1/dailies']) {
    app.use(path, sessionAuth(deps, options.getClientIp), subjectRateLimit(deps));
  }

  app.onError((error, c) => onError(bodyError(error, c.req.path), c));

  app.openapi(meta, (c) =>
    c.json({ githubClientId: deps.env.githubClientId, supportEmail: deps.env.supportEmail }, 200),
  );

  app.openapi(
    sessions,
    async (c) => c.json(await startSession(deps, c.req.valid('json')), 200),
    (result) => {
      if (!result.success) {
        throw new DomainError('invalid_request', 'githubToken is required', result.error.issues);
      }
    },
  );

  app.openapi(draft, async (c) =>
    c.json(await getDraft(deps, isMember, c.get('member'), c.req.valid('query').org), 200),
  );

  app.openapi(
    dailies,
    async (c) =>
      c.json(await submitDaily(deps, isMember, c.get('member'), c.req.valid('json')), 200),
    (result) => {
      if (!result.success) {
        throw new DomainError('invalid_daily', 'invalid daily', result.error.issues);
      }
    },
  );

  return app;
}
