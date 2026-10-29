import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  type Deps,
  DomainError,
  getOrgDaily,
  listOrgBlockers,
  listOrgDailies,
  listOrgDigests,
  listOrgTeams,
  type OrgBlocker,
  type OrgDaily,
  type OrgDigest,
  type Page,
} from '@standwise/orchestrator';
import { type ApiKeyEnv, apiKeyChain } from '../middleware/api-key';
import type { GetClientIp } from '../middleware/rate-limit';
import {
  ORG_BLOCKERS_EXAMPLE,
  ORG_DAILIES_EXAMPLE,
  ORG_DAILY_EXAMPLE,
  ORG_DIGESTS_EXAMPLE,
  ORG_TEAMS_EXAMPLE,
  OrgBlockerListSchema,
  OrgDailyListSchema,
  OrgDailySchema,
  OrgDigestListSchema,
  OrgTeamListSchema,
} from '../openapi/org-schemas';
import { errorResponse, RATE_LIMITED, rateHeaders } from '../openapi/schemas';

export type OrgOptions = { getClientIp: GetClientIp };

const UNAUTHORIZED = errorResponse('Missing, invalid or revoked API key.', {
  unauthorized: 'missing or invalid api key',
});

const forbidden = (scope: string) =>
  errorResponse(
    `The API key does not have the \`${scope}\` scope.`,
    { insufficient_scope: `api key lacks the ${scope} scope` },
    { required_scope: scope },
  );

const NOT_CONFIGURED = errorResponse('The organization is not ready to use.', {
  org_not_configured: 'organization has no valid standwise.yml',
});

const INVALID_QUERY = errorResponse('A query parameter is not valid.', {
  invalid_request: 'cursor is not valid',
});

const cursor = z.string().optional().openapi({
  description: 'The `next_cursor` of the previous page. Omit it to get the first page.',
  example:
    'eyJkYXRlIjoiMjAyNi0xMC0yOCIsImlkIjoiN2IxYzJmMGUtNWEwYi00YTYzLTlhNDMtMGQyYTFmMGY5ZDExIn0',
});

const limit = z.coerce.number().int().min(1).max(100).default(50).openapi({
  description: 'Page size, from 1 to 100.',
  example: 50,
});

const date = (description: string) =>
  z.string().optional().openapi({ description, example: '2026-10-28' });

const team = z.string().optional().openapi({
  description: 'Only this team, by name as written in `standwise.yml`.',
  example: 'Alpha',
});

const BASE_ERRORS = (scope: string) => ({
  401: UNAUTHORIZED,
  403: forbidden(scope),
  409: NOT_CONFIGURED,
  422: INVALID_QUERY,
  429: RATE_LIMITED,
});

const teams = createRoute({
  method: 'get',
  path: '/v1/org/teams',
  tags: ['Organization'],
  summary: 'List the teams',
  description:
    'Returns the teams configured in `standwise.yml` of the key organization: name, time zone, workdays, reminder and digest times, and the lowercase GitHub logins of the members. All teams come in one page, so `next_cursor` is always `null`. Requires the `teams:read` scope.\n\nRetorna os times configurados no `standwise.yml` da organização da key: nome, fuso, dias úteis, horários do lembrete e do consolidado e os logins do GitHub (minúsculos) dos membros. Todos os times vêm em uma página, então `next_cursor` é sempre `null`. Exige o escopo `teams:read`.',
  security: [{ apiKey: [] }],
  responses: {
    200: {
      description: 'The teams.',
      headers: rateHeaders,
      content: { 'application/json': { schema: OrgTeamListSchema, example: ORG_TEAMS_EXAMPLE } },
    },
    ...BASE_ERRORS('teams:read'),
  },
});

const dailies = createRoute({
  method: 'get',
  path: '/v1/org/dailies',
  tags: ['Organization'],
  summary: 'List the dailies',
  description:
    'Returns the confirmed dailies of the key organization, newest first, paginated by cursor. `teams` is computed from the current `standwise.yml`. Filter by standup `date` and by `team`. Suggestions and per-person aggregates are never returned. Requires the `dailies:read` scope.\n\nRetorna as dailies confirmadas da organização da key, da mais recente para a mais antiga, paginadas por cursor. `teams` é calculado a partir do `standwise.yml` atual. Filtre pela `date` da daily e pelo `team`. Sugestões e agregados por pessoa nunca são devolvidos. Exige o escopo `dailies:read`.',
  security: [{ apiKey: [] }],
  request: {
    query: z.object({
      date: date('Only dailies of this standup date, YYYY-MM-DD.'),
      team,
      cursor,
      limit,
    }),
  },
  responses: {
    200: {
      description: 'A page of dailies.',
      headers: rateHeaders,
      content: {
        'application/json': { schema: OrgDailyListSchema, example: ORG_DAILIES_EXAMPLE },
      },
    },
    ...BASE_ERRORS('dailies:read'),
  },
});

const daily = createRoute({
  method: 'get',
  path: '/v1/org/dailies/{id}',
  tags: ['Organization'],
  summary: 'Get a daily',
  description:
    'Returns one daily of the key organization by id. A daily of another organization is reported as not found. Requires the `dailies:read` scope.\n\nRetorna uma daily da organização da key pelo id. Uma daily de outra organização é tratada como inexistente. Exige o escopo `dailies:read`.',
  security: [{ apiKey: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ example: ORG_DAILY_EXAMPLE.id, description: 'Daily id.' }),
    }),
  },
  responses: {
    200: {
      description: 'The daily.',
      headers: rateHeaders,
      content: { 'application/json': { schema: OrgDailySchema, example: ORG_DAILY_EXAMPLE } },
    },
    ...BASE_ERRORS('dailies:read'),
    404: errorResponse('The daily does not exist in this organization.', {
      not_found: 'daily not found',
    }),
  },
});

const digests = createRoute({
  method: 'get',
  path: '/v1/org/digests',
  tags: ['Organization'],
  summary: 'List the digests',
  description:
    'Returns the digest deliveries of the key organization, newest first, paginated by cursor: team, date, delivery `status`, `sentAt` and `missing`, the team members who had not sent the daily for that date. Filter by `team` and by the inclusive `from` and `to` dates. Requires the `digests:read` scope.\n\nRetorna as entregas do consolidado da organização da key, da mais recente para a mais antiga, paginadas por cursor: time, data, `status` da entrega, `sentAt` e `missing`, os membros do time que não tinham enviado a daily daquela data. Filtre por `team` e pelas datas inclusivas `from` e `to`. Exige o escopo `digests:read`.',
  security: [{ apiKey: [] }],
  request: {
    query: z.object({
      team,
      from: date('Only digests on or after this date, YYYY-MM-DD.'),
      to: date('Only digests on or before this date, YYYY-MM-DD.'),
      cursor,
      limit,
    }),
  },
  responses: {
    200: {
      description: 'A page of digests.',
      headers: rateHeaders,
      content: {
        'application/json': { schema: OrgDigestListSchema, example: ORG_DIGESTS_EXAMPLE },
      },
    },
    ...BASE_ERRORS('digests:read'),
  },
});

const blockers = createRoute({
  method: 'get',
  path: '/v1/org/blockers',
  tags: ['Organization'],
  summary: 'List the blockers',
  description:
    'Returns the blockers that people confirmed in their dailies, newest first, paginated by cursor, each with its author, date and teams. `limit` counts blockers, not dailies. Filter by standup `date` and by `team`. Requires the `blockers:read` scope.\n\nRetorna os impedimentos que as pessoas confirmaram nas dailies, do mais recente para o mais antigo, paginados por cursor, cada um com autor, data e times. `limit` conta impedimentos, não dailies. Filtre pela `date` e pelo `team`. Exige o escopo `blockers:read`.',
  security: [{ apiKey: [] }],
  request: {
    query: z.object({
      date: date('Only blockers of this standup date, YYYY-MM-DD.'),
      team,
      cursor,
      limit,
    }),
  },
  responses: {
    200: {
      description: 'A page of blockers.',
      headers: rateHeaders,
      content: {
        'application/json': { schema: OrgBlockerListSchema, example: ORG_BLOCKERS_EXAMPLE },
      },
    },
    ...BASE_ERRORS('blockers:read'),
  },
});

const toPage = <T, R>(page: Page<T>, map: (row: T) => R) => ({
  data: page.data.map(map),
  next_cursor: page.nextCursor,
});

const dailyJson = (d: OrgDaily) => ({ ...d, submittedAt: d.submittedAt.toISOString() });
const digestJson = (d: OrgDigest) => ({ ...d, sentAt: d.sentAt?.toISOString() ?? null });
const blockerJson = (b: OrgBlocker) => b;

export function orgRoutes(deps: Deps, options: OrgOptions): OpenAPIHono<ApiKeyEnv> {
  const app = new OpenAPIHono<ApiKeyEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new DomainError('invalid_request', 'invalid request', result.error.issues);
      }
    },
  });
  const scoped = (path: string, scope: Parameters<typeof apiKeyChain>[2]) =>
    app.use(path, ...apiKeyChain(deps, options.getClientIp, scope));
  scoped('/v1/org/teams', 'teams:read');
  scoped('/v1/org/dailies', 'dailies:read');
  scoped('/v1/org/dailies/:id', 'dailies:read');
  scoped('/v1/org/digests', 'digests:read');
  scoped('/v1/org/blockers', 'blockers:read');
  const installation = (c: { get: (k: 'apiKey') => { installationId: number } }) =>
    c.get('apiKey').installationId;

  app.openapi(teams, async (c) =>
    c.json({ data: await listOrgTeams(deps, installation(c)), next_cursor: null }, 200),
  );
  app.openapi(dailies, async (c) =>
    c.json(
      toPage(await listOrgDailies(deps, installation(c), c.req.valid('query')), dailyJson),
      200,
    ),
  );
  app.openapi(daily, async (c) =>
    c.json(dailyJson(await getOrgDaily(deps, installation(c), c.req.valid('param').id)), 200),
  );
  app.openapi(digests, async (c) =>
    c.json(
      toPage(await listOrgDigests(deps, installation(c), c.req.valid('query')), digestJson),
      200,
    ),
  );
  app.openapi(blockers, async (c) =>
    c.json(
      toPage(await listOrgBlockers(deps, installation(c), c.req.valid('query')), blockerJson),
      200,
    ),
  );
  return app;
}
