import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  type Deps,
  DomainError,
  listManagedBlockers,
  listManagedDailies,
  listManagedDigests,
  listManagedTeams,
  type MembershipCheck,
} from '@standcast/orchestrator';
import type { SessionEnv } from '../middleware/session-auth';
import {
  ORG_BLOCKERS_EXAMPLE,
  ORG_DAILIES_EXAMPLE,
  ORG_DIGESTS_EXAMPLE,
  ORG_TEAMS_EXAMPLE,
  OrgBlockerListSchema,
  OrgDailyListSchema,
  OrgDigestListSchema,
  OrgTeamListSchema,
} from '../openapi/org-schemas';
import { errorResponse, RATE_LIMITED, rateHeaders } from '../openapi/schemas';
import { blockerJson, dailyJson, digestJson, toPage } from './org';

const org = z.string().optional().openapi({
  description: 'Organization login. Required.',
  example: 'acme',
});

const team = z.string().optional().openapi({
  description: 'Team name as written in `standcast.yml`. Required.',
  example: 'Alpha',
});

const day = (description: string) =>
  z.string().optional().openapi({ description, example: '2026-10-28' });

const range = {
  from: day('First date, YYYY-MM-DD. Defaults to 89 days before today in the team time zone.'),
  to: day('Last date, YYYY-MM-DD. Defaults to today in the team time zone.'),
  cursor: z.string().optional().openapi({
    description: 'The `next_cursor` of the previous page. Omit it to get the first page.',
  }),
  limit: z.coerce.number().int().min(1).max(100).default(50).openapi({
    description: 'Page size, from 1 to 100.',
    example: 50,
  }),
};

const ERRORS = {
  401: errorResponse('Missing, invalid or expired session.', {
    unauthorized: 'missing or invalid session',
  }),
  403: errorResponse(
    'The person cannot read this team or organization. Unknown teams get the same answer.',
    { forbidden: 'you cannot read this team' },
  ),
  404: errorResponse('The organization was not found.', {
    org_not_found: 'organization not found',
  }),
  409: errorResponse('The organization is not ready to use.', {
    org_not_configured: 'organization has no valid standcast.yml',
  }),
  422: errorResponse('A query parameter is not valid, or the range is outside the window.', {
    invalid_request: 'history is limited to the last 90 days, from 2026-07-31 to 2026-10-28',
  }),
  429: RATE_LIMITED,
};

const RULES =
  'Only what people confirmed is returned: no suggestions and no per-person aggregates. Readable by the managers of the team listed in `standcast.yml` and by organization admins. History is limited to the last 90 days, today included, in the team time zone.';
const RULES_PT =
  'Só o que as pessoas confirmaram é devolvido: sem sugestões e sem agregados por pessoa. Podem ler os gestores do time listados no `standcast.yml` e os admins da organização. O histórico vai até 90 dias atrás, contando hoje, no fuso do time.';

const listRoute = <S extends z.ZodType>(
  resource: 'digests' | 'dailies' | 'blockers',
  summary: string,
  en: string,
  pt: string,
  schema: S,
  example: unknown,
) =>
  createRoute({
    method: 'get',
    path: `/v1/manage/${resource}`,
    tags: ['Manage'],
    summary,
    description: `${en} ${RULES}\n\n${pt} ${RULES_PT}`,
    security: [{ session: [] }],
    request: { query: z.object({ org, team, ...range }) },
    responses: {
      200: {
        description: `A page of ${resource}.`,
        headers: rateHeaders,
        content: { 'application/json': { schema, example } },
      },
      ...ERRORS,
    },
  });

const teams = createRoute({
  method: 'get',
  path: '/v1/manage/teams',
  tags: ['Manage'],
  summary: 'List the teams the person can read',
  description:
    'Returns the teams of the organization that the person manages, or every team for an organization admin. Used by the MCP server.\n\nRetorna os times da organização que a pessoa gerencia, ou todos os times para um admin da organização. Usado pelo servidor MCP.',
  security: [{ session: [] }],
  request: { query: z.object({ org }) },
  responses: {
    200: {
      description: 'The readable teams.',
      headers: rateHeaders,
      content: { 'application/json': { schema: OrgTeamListSchema, example: ORG_TEAMS_EXAMPLE } },
    },
    ...ERRORS,
  },
});

const digests = listRoute(
  'digests',
  'List the digests of a team',
  'Returns the digest deliveries of one team, newest first, with who had not sent the daily.',
  'Retorna as entregas do consolidado de um time, da mais recente para a mais antiga, com quem não tinha enviado a daily.',
  OrgDigestListSchema,
  ORG_DIGESTS_EXAMPLE,
);

const dailies = listRoute(
  'dailies',
  'List the dailies of a team',
  'Returns the confirmed dailies of the members of one team, newest first.',
  'Retorna as dailies confirmadas dos membros de um time, da mais recente para a mais antiga.',
  OrgDailyListSchema,
  ORG_DAILIES_EXAMPLE,
);

const blockers = listRoute(
  'blockers',
  'List the blockers of a team',
  'Returns the blockers confirmed by the members of one team, newest first.',
  'Retorna os impedimentos confirmados pelos membros de um time, do mais recente para o mais antigo.',
  OrgBlockerListSchema,
  ORG_BLOCKERS_EXAMPLE,
);

export function manageRoutes(deps: Deps, isMember: MembershipCheck): OpenAPIHono<SessionEnv> {
  const app = new OpenAPIHono<SessionEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new DomainError('invalid_request', 'invalid request', result.error.issues);
      }
    },
  });

  app.openapi(teams, async (c) =>
    c.json(
      {
        data: await listManagedTeams(deps, isMember, c.get('member'), c.req.valid('query').org),
        next_cursor: null,
      },
      200,
    ),
  );
  app.openapi(digests, async (c) =>
    c.json(
      toPage(
        await listManagedDigests(deps, isMember, c.get('member'), c.req.valid('query')),
        digestJson,
      ),
      200,
    ),
  );
  app.openapi(dailies, async (c) =>
    c.json(
      toPage(
        await listManagedDailies(deps, isMember, c.get('member'), c.req.valid('query')),
        dailyJson,
      ),
      200,
    ),
  );
  app.openapi(blockers, async (c) =>
    c.json(
      toPage(
        await listManagedBlockers(deps, isMember, c.get('member'), c.req.valid('query')),
        blockerJson,
      ),
      200,
    ),
  );
  return app;
}
