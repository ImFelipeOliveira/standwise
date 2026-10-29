import { DailySubmissionSchema } from '@standwise/core';
import { type MemberRow, resolveSession } from '@standwise/db';
import {
  createMembershipCheck,
  type Deps,
  DomainError,
  getDraft,
  startSession,
  submitDaily,
} from '@standwise/orchestrator';
import { Hono } from 'hono';
import { z } from 'zod';

type Env = { Variables: { member: MemberRow } };

const SessionRequest = z.object({ githubToken: z.string().min(1) });

export function v1Routes(deps: Deps): Hono<Env> {
  const app = new Hono<Env>();
  const isMember = createMembershipCheck(deps);

  app.get('/meta', (c) =>
    c.json({ githubClientId: deps.env.githubClientId, supportEmail: deps.env.supportEmail }),
  );

  app.post('/sessions', async (c) => {
    const body = SessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw new DomainError('invalid_request', 'githubToken is required', body.error.issues);
    }
    return c.json(await startSession(deps, body.data));
  });

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const member = token ? await resolveSession(deps.db, token, 'cli') : null;
    if (!member) throw new DomainError('unauthorized', 'missing or invalid session');
    c.set('member', member);
    await next();
  });

  app.get('/draft', async (c) =>
    c.json(await getDraft(deps, isMember, c.get('member'), c.req.query('org'))),
  );

  app.post('/dailies', async (c) => {
    const parsed = DailySubmissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError('invalid_daily', 'invalid daily', parsed.error.issues);
    }
    return c.json(await submitDaily(deps, isMember, c.get('member'), parsed.data));
  });

  return app;
}
