import { negotiateLanguage } from '@standwise/core';
import { type MemberRow, resolveSession } from '@standwise/db';
import {
  completeSlackConnect,
  completeWebLogin,
  createMembershipCheck,
  type Deps,
  DomainError,
  getSetupStatus,
  startSlackConnect,
  startWebLogin,
} from '@standwise/orchestrator';
import { type Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { SetupPage } from '../web/setup';

const COOKIE = 'sw_web';
const WEB_SESSION_SECONDS = 7 * 24 * 60 * 60;

type Session = { token: string; member: MemberRow };

export function webRoutes(deps: Deps): Hono {
  const app = new Hono();
  const isMember = createMembershipCheck(deps);

  const readSession = async (c: Context): Promise<Session | null> => {
    const token = getCookie(c, COOKIE);
    const member = token ? await resolveSession(deps.db, token, 'web') : null;
    return token && member ? { token, member } : null;
  };

  const requireSession = async (c: Context): Promise<Session> => {
    const session = await readSession(c);
    if (!session) throw new DomainError('unauthorized', 'login required');
    return session;
  };

  const loginRedirect = (c: Context) => {
    const url = new URL(c.req.url);
    return c.redirect(
      `/auth/github/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
    );
  };

  const installationId = (c: Context) => {
    const raw = c.req.query('installation_id');
    return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
  };

  app.get('/auth/github/login', (c) =>
    c.redirect(startWebLogin(deps, { next: c.req.query('next') }).url),
  );

  app.get('/auth/github/callback', async (c) => {
    const { token, next } = await completeWebLogin(deps, {
      code: c.req.query('code'),
      state: c.req.query('state'),
    });
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: WEB_SESSION_SECONDS,
    });
    return c.redirect(next);
  });

  app.get('/setup', async (c) => {
    const session = await readSession(c);
    if (!session) return loginRedirect(c);
    const status = await getSetupStatus(deps, isMember, session.member, installationId(c));
    return c.html(
      <SetupPage lang={negotiateLanguage(c.req.header('accept-language'))} status={status} />,
    );
  });

  app.get('/connect/slack', async (c) => {
    const session = await readSession(c);
    if (!session) return loginRedirect(c);
    const { url } = await startSlackConnect(deps, isMember, session.member, {
      sessionToken: session.token,
      installationId: installationId(c),
    });
    return c.redirect(url);
  });

  app.get('/oauth/slack/callback', async (c) => {
    const session = await requireSession(c);
    const { installationId: id } = await completeSlackConnect(deps, isMember, session.member, {
      sessionToken: session.token,
      code: c.req.query('code'),
      state: c.req.query('state'),
    });
    return c.redirect(`/setup?installation_id=${id}`);
  });

  return app;
}
