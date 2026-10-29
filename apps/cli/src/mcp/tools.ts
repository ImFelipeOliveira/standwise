import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DailySubmissionSchema } from '@standwise/core';
import { z } from 'zod';
import { ApiError, getDraft, getManage, NetworkError, postDaily } from '../api';
import { type Ctx, EXIT, ExitError, type Io } from '../io';
import { requireBoundCredentials, requireCredentials, resolveOrg } from '../session';
import { stripControl } from '../url';

const EXIT_CODES: Record<number, string> = {
  [EXIT.unauthenticated]: 'not_logged_in',
  [EXIT.ambiguousOrg]: 'ambiguous_org',
  [EXIT.invalid]: 'invalid_input',
};

export const CONFIRMATION_RULE =
  'confirmation_required: show the final daily to the person, get their explicit confirmation, then call again with confirmed: true. Nothing was sent.';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const org = z
  .string()
  .min(1)
  .optional()
  .describe('Organization login. Optional when the person belongs to a single organization.');
const team = z.string().min(1).describe('Team name as written in standwise.yml.');
const cursor = z.string().optional().describe('next_cursor of the previous page.');

const itemOut = z.looseObject({
  text: z.string(),
  ref: z
    .looseObject({ kind: z.string(), url: z.string(), title: z.string().nullable() })
    .nullable(),
});

const page = <T extends z.ZodType>(item: T) => ({
  data: z.array(item),
  next_cursor: z.string().nullable(),
});

const teamOut = z.looseObject({
  name: z.string(),
  timezone: z.string(),
  workdays: z.array(z.string()),
  remindAt: z.string(),
  digestAt: z.string(),
  memberLogins: z.array(z.string()),
});

const digestOut = z.looseObject({
  team: z.string(),
  date: z.string(),
  status: z.string(),
  sentAt: z.string().nullable(),
  missing: z.array(z.string()),
});

const dailyOut = z.looseObject({
  id: z.string(),
  login: z.string(),
  date: z.string(),
  submittedAt: z.string(),
  teams: z.array(z.string()),
  yesterday: z.array(itemOut),
  today: z.array(itemOut),
  blockers: z.array(itemOut),
});

const blockerOut = z.looseObject({
  text: z.string(),
  ref: itemOut.shape.ref,
  author: z.string(),
  date: z.string(),
  teams: z.array(z.string()),
});

const draftOut = z.looseObject({
  org: z.string(),
  date: z.string(),
  since: z.string(),
  teams: z.array(z.string()),
  activity: z.array(z.unknown()),
  suggestions: z.array(z.string()),
});

class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function toolError(error: unknown): CallToolResult {
  const failure = (code: string, message: string): CallToolResult => ({
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
  });
  if (error instanceof ToolError) return failure(error.code, error.message);
  if (error instanceof ExitError) {
    return failure(EXIT_CODES[error.exitCode] ?? 'cli_error', error.message);
  }
  if (error instanceof ApiError) return failure(error.code, error.message);
  if (error instanceof NetworkError) {
    return failure('network_error', `could not reach ${stripControl(error.url)}`);
  }
  throw error;
}

async function respond(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = (await work()) as Record<string, unknown>;
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    return toolError(error);
  }
}

function toolCtx(io: Io, orgLogin?: string): Ctx {
  return { io, lang: 'en', flags: { org: orgLogin } };
}

async function session(io: Io, orgLogin?: string) {
  const ctx = toolCtx(io, orgLogin);
  const { credentials, apiUrl } = await requireBoundCredentials(ctx);
  return { token: credentials.token, apiUrl, org: resolveOrg(ctx, credentials) };
}

export function registerTools(server: McpServer, io: Io): void {
  server.registerTool(
    'standwise_whoami',
    {
      title: 'Who am I',
      description: 'Returns the GitHub login signed in to Standwise and the organizations.',
      inputSchema: {},
      outputSchema: {
        login: z.string(),
        orgs: z.array(z.object({ installationId: z.number(), login: z.string() })),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      respond(async () => {
        const { login, orgs } = await requireCredentials(toolCtx(io));
        return { login, orgs };
      }),
  );

  server.registerTool(
    'standwise_get_draft',
    {
      title: 'Get the daily draft',
      description:
        "Builds the draft of yesterday's work from the person's GitHub activity. Use it as a starting point: the person decides what goes in the daily.",
      inputSchema: { org },
      outputSchema: draftOut,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      respond(async () => {
        const s = await session(io, input.org);
        return getDraft(s.apiUrl, s.token, s.org);
      }),
  );

  server.registerTool(
    'standwise_submit_daily',
    {
      title: 'Submit the daily',
      description:
        "Submits the person's daily to their teams. Before calling, you MUST show the final daily to the person and get their explicit confirmation; only then call with confirmed: true. Send each item exactly as the person wrote or approved it: never translate or rewrite it. Submitting again on the same day replaces the previous daily.",
      inputSchema: {
        org,
        yesterday: DailySubmissionSchema.shape.yesterday.describe('What the person did.'),
        today: DailySubmissionSchema.shape.today.describe('What the person will do today.'),
        blockers: DailySubmissionSchema.shape.blockers.describe('What is blocking the person.'),
        confirmed: z
          .literal(true, { error: CONFIRMATION_RULE })
          .describe('Must be true, only after the person explicitly confirmed this daily.'),
      },
      outputSchema: { date: z.string(), teams: z.array(z.string()), late: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (input) =>
      respond(async () => {
        if (input.confirmed !== true)
          throw new ToolError('confirmation_required', CONFIRMATION_RULE);
        const s = await session(io, input.org);
        return postDaily(s.apiUrl, s.token, {
          org: s.org,
          yesterday: input.yesterday,
          today: input.today,
          blockers: input.blockers,
        });
      }),
  );

  server.registerTool(
    'standwise_list_teams',
    {
      title: 'List the teams I can read',
      description:
        'Lists the teams the person manages, or every team for an organization admin. Only these teams can be read with the other manager tools.',
      inputSchema: { org },
      outputSchema: page(teamOut),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      respond(async () => {
        const s = await session(io, input.org);
        return getManage(s.apiUrl, s.token, 'teams', { org: s.org });
      }),
  );

  server.registerTool(
    'standwise_get_digest',
    {
      title: 'Get a team digest',
      description:
        'Returns the digest delivery of a team on one date, with who had not sent the daily, or null when there is none. Limited to the last 90 days.',
      inputSchema: { org, team, date: day.describe('Standup date, YYYY-MM-DD.') },
      outputSchema: { digest: digestOut.nullable() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      respond(async () => {
        const s = await session(io, input.org);
        const result = (await getManage(s.apiUrl, s.token, 'digests', {
          org: s.org,
          team: input.team,
          from: input.date,
          to: input.date,
        })) as { data: unknown[] };
        return { digest: result.data[0] ?? null };
      }),
  );

  server.registerTool(
    'standwise_list_dailies',
    {
      title: 'List team dailies',
      description:
        'Lists the confirmed dailies of a team between two dates, newest first, paginated. Limited to the last 90 days.',
      inputSchema: {
        org,
        team,
        from: day.describe('First date, YYYY-MM-DD.'),
        to: day.describe('Last date, YYYY-MM-DD.'),
        cursor,
      },
      outputSchema: page(dailyOut),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      respond(async () => {
        const s = await session(io, input.org);
        return getManage(s.apiUrl, s.token, 'dailies', {
          org: s.org,
          team: input.team,
          from: input.from,
          to: input.to,
          cursor: input.cursor,
        });
      }),
  );

  server.registerTool(
    'standwise_list_blockers',
    {
      title: 'List team blockers',
      description:
        'Lists the blockers confirmed by the members of a team, newest first, paginated. Without from and to, covers the last 90 days.',
      inputSchema: {
        org,
        team,
        from: day.optional().describe('First date, YYYY-MM-DD.'),
        to: day.optional().describe('Last date, YYYY-MM-DD.'),
        cursor,
      },
      outputSchema: page(blockerOut),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      respond(async () => {
        const s = await session(io, input.org);
        return getManage(s.apiUrl, s.token, 'blockers', {
          org: s.org,
          team: input.team,
          from: input.from,
          to: input.to,
          cursor: input.cursor,
        });
      }),
  );
}
