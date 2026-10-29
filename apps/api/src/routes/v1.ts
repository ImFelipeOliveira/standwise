import {
  activitySince,
  type DailySubmission,
  DailySubmissionSchema,
  dailyDateFor,
  type ResolvedTeam,
  teamsForMember,
} from '@standwise/core';
import {
  createSession,
  getDelivery,
  getInstallation,
  getLastDaily,
  listMemberInstallations,
  type MemberRow,
  resolveSession,
  setMemberInstallations,
  upsertDaily,
  upsertMember,
} from '@standwise/db';
import { type Deps, linkChatIdentities, resolveTeams } from '@standwise/orchestrator';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

type Env = { Variables: { member: MemberRow } };

type Failure = { status: 401 | 404 | 409 | 422; code: string; message: string; issues?: unknown };

class ApiError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message);
  }
}

const fail = (status: Failure['status'], code: string, message: string, issues?: unknown) =>
  new ApiError({ status, code, message, issues });

const SessionRequest = z.object({ githubToken: z.string().min(1) });

type OrgContext = {
  installationId: number;
  owner: string;
  mine: ResolvedTeam[];
  date: string;
};

async function loadOrg(
  deps: Deps,
  member: MemberRow,
  org: string | undefined,
): Promise<OrgContext> {
  const wanted = (org ?? '').toLowerCase();
  const entry = (await listMemberInstallations(deps.db, member.id)).find(
    (i) => i.accountLogin.toLowerCase() === wanted,
  );
  if (!entry) throw fail(404, 'org_not_found', `organization ${org ?? ''} not found`);
  const installation = await getInstallation(deps.db, entry.installationId);
  if (installation?.status !== 'configured' || !installation.config) {
    throw fail(409, 'org_not_configured', `organization ${entry.accountLogin} is not configured`);
  }
  const teams = await resolveTeams(
    deps,
    installation.id,
    installation.accountLogin,
    installation.config,
  );
  const mine = teamsForMember(member.login, teams);
  const first = mine[0];
  if (!first) throw fail(422, 'not_in_team', 'you are not in any team of this organization');
  return {
    installationId: installation.id,
    owner: installation.accountLogin,
    mine,
    date: dailyDateFor(deps.now(), first),
  };
}

async function isLate(deps: Deps, ctx: OrgContext): Promise<boolean> {
  for (const team of ctx.mine) {
    const delivery = await getDelivery(deps.db, {
      installationId: ctx.installationId,
      teamName: team.name,
      date: ctx.date,
      kind: 'digest',
    });
    if (delivery?.status === 'sent') return true;
  }
  return false;
}

export function v1Routes(deps: Deps): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((error, c: Context) => {
    if (error instanceof ApiError) {
      const { status, code, message, issues } = error.failure;
      return c.json({ error: { code, message, ...(issues ? { issues } : {}) } }, status);
    }
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });

  app.get('/meta', (c) =>
    c.json({ githubClientId: deps.env.githubClientId, supportEmail: deps.env.supportEmail }),
  );

  app.post('/sessions', async (c) => {
    const body = SessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw fail(422, 'invalid_request', 'githubToken is required', body.error.issues);
    }
    const profile = await deps.github.getUserProfile(body.data.githubToken, {
      appId: Number(deps.env.appId),
    });
    const member = await upsertMember(deps.db, {
      githubUserId: profile.githubUserId,
      login: profile.login,
      email: profile.email,
    });
    const known: { id: number; accountLogin: string }[] = [];
    for (const id of profile.installationIds) {
      const installation = await getInstallation(deps.db, id);
      if (installation) known.push({ id, accountLogin: installation.accountLogin });
    }
    const ids = known.map((i) => i.id);
    await setMemberInstallations(deps.db, member.id, ids);
    await linkChatIdentities(deps, member.id, profile.email, ids);
    const token = await createSession(deps.db, member.id, 'cli');
    return c.json({
      token,
      login: member.login,
      orgs: known.map((i) => ({ installationId: i.id, login: i.accountLogin })),
    });
  });

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const member = token ? await resolveSession(deps.db, token, 'cli') : null;
    if (!member) throw fail(401, 'unauthorized', 'missing or invalid session');
    c.set('member', member);
    await next();
  });

  app.get('/draft', async (c) => {
    const member = c.get('member');
    const ctx = await loadOrg(deps, member, c.req.query('org'));
    const cal = ctx.mine[0] as ResolvedTeam;
    const lastDaily = await getLastDaily(deps.db, ctx.installationId, member.id, ctx.date);
    const since = activitySince({ date: ctx.date, cal, ...(lastDaily ? { lastDaily } : {}) });
    const octokit = await deps.github.installationOctokit(ctx.installationId);
    const activity = await deps.github.listActivity(octokit, ctx.owner, member.login, since);
    return c.json({
      org: ctx.owner,
      date: ctx.date,
      since: since.toISOString(),
      teams: ctx.mine.map((t) => t.name),
      activity,
      suggestions: [],
    });
  });

  app.post('/dailies', async (c) => {
    const member = c.get('member');
    const parsed = DailySubmissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw fail(422, 'invalid_daily', 'invalid daily', parsed.error.issues);
    }
    const payload: DailySubmission = parsed.data;
    const ctx = await loadOrg(deps, member, payload.org);
    await upsertDaily(deps.db, {
      installationId: ctx.installationId,
      memberId: member.id,
      date: ctx.date,
      payload,
      submittedAt: deps.now(),
    });
    const late = await isLate(deps, ctx);
    if (late) {
      await deps.queue.enqueue('send-late-daily', {
        installationId: ctx.installationId,
        memberId: member.id,
        date: ctx.date,
      });
    }
    return c.json({ date: ctx.date, teams: ctx.mine.map((t) => t.name), late });
  });

  return app;
}
