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
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { STATUS } from '../http/errors';
import { ErrorPage } from '../web/error';
import { SetupPage } from '../web/setup';

const COOKIE = 'sw_web';
const LOGIN_COOKIE = 'sw_login';
const LOGIN_COOKIE_PATH = '/auth/github';
const LOGIN_NONCE_SECONDS = 600;
const SIGN_IN_CODES = ['unauthorized', 'forbidden', 'invalid_state', 'access_denied'];
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

  app.onError((error, c) => {
    const lang = negotiateLanguage(c.req.header('accept-language'));
    if (!(error instanceof DomainError)) {
      console.error(error);
      return c.html(<ErrorPage lang={lang} code="generic" />, 500);
    }
    const url = new URL(c.req.url);
    const action = SIGN_IN_CODES.includes(error.code)
      ? { kind: 'signIn' as const, href: '/auth/github/login' }
      : error.code === 'installation_pending'
        ? { kind: 'refresh' as const, href: `${url.pathname}${url.search}` }
        : undefined;
    return c.html(<ErrorPage lang={lang} code={error.code} action={action} />, STATUS[error.code]);
  });

  const resyncOnPending = async <T,>(c: Context, run: () => Promise<T>): Promise<T | Response> => {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'installation_pending') throw error;
      const url = new URL(c.req.url);
      if (url.searchParams.get('resynced') === '1') throw error;
      url.searchParams.set('resynced', '1');
      return c.redirect(
        `/auth/github/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
      );
    }
  };

  app.get('/auth/github/login', (c) => {
    const { url, nonce } = startWebLogin(deps, { next: c.req.query('next') });
    setCookie(c, LOGIN_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: LOGIN_COOKIE_PATH,
      maxAge: LOGIN_NONCE_SECONDS,
    });
    return c.redirect(url);
  });

  app.get('/auth/github/callback', async (c) => {
    const { token, next } = await completeWebLogin(deps, {
      code: c.req.query('code'),
      state: c.req.query('state'),
      nonce: getCookie(c, LOGIN_COOKIE),
      error: c.req.query('error'),
    });
    deleteCookie(c, LOGIN_COOKIE, { path: LOGIN_COOKIE_PATH, secure: true });
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
    const result = await resyncOnPending(c, () =>
      getSetupStatus(deps, isMember, session.member, installationId(c)),
    );
    if (result instanceof Response) return result;
    return c.html(
      <SetupPage lang={negotiateLanguage(c.req.header('accept-language'))} status={result} />,
    );
  });

  app.get('/connect/slack', async (c) => {
    const session = await readSession(c);
    if (!session) return loginRedirect(c);
    const result = await resyncOnPending(c, () =>
      startSlackConnect(deps, isMember, session.member, {
        sessionToken: session.token,
        installationId: installationId(c),
      }),
    );
    return result instanceof Response ? result : c.redirect(result.url);
  });

  app.get('/oauth/slack/callback', async (c) => {
    const session = await requireSession(c);
    const { installationId: id } = await completeSlackConnect(deps, isMember, session.member, {
      sessionToken: session.token,
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
    });
    return c.redirect(`/setup?installation_id=${id}`);
  });

  return app;
}
