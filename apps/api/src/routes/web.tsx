import { negotiateLanguage } from '@standwise/core';
import { API_KEY_SCOPES, type MemberRow, resolveSession, WEBHOOK_EVENTS } from '@standwise/db';
import {
  completeSlackConnect,
  completeWebLogin,
  createInstallationApiKey,
  createMembershipCheck,
  createWebhookEndpoint,
  csrfToken,
  type Deps,
  DomainError,
  disableWebhookEndpoint,
  getSetupStatus,
  revokeInstallationApiKey,
  type SetupStatus,
  sendTestEvent,
  startSlackConnect,
  startWebLogin,
  verifyCsrf,
} from '@standwise/orchestrator';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import installScript from '../../../../scripts/install.sh' with { type: 'text' };
import { STATUS } from '../http/errors';
import { ErrorPage } from '../web/error';
import {
  FLASH_COOKIE,
  FLASH_PATH,
  FLASH_SECONDS,
  type FlashValue,
  openFlash,
  sealFlash,
} from '../web/flash';
import { SetupPage } from '../web/setup';

const COOKIE = 'sw_web';
const LOGIN_COOKIE = 'sw_login';
const LOGIN_COOKIE_PATH = '/auth/github';
const LOGIN_NONCE_SECONDS = 600;
const SIGN_IN_CODES = ['unauthorized', 'forbidden', 'invalid_state', 'access_denied'];
const WEB_SESSION_SECONDS = 7 * 24 * 60 * 60;

type Session = { token: string; member: MemberRow };

const installationField = z.string().regex(/^\d+$/).transform(Number);

const createKeyForm = z.object({
  installation_id: installationField,
  name: z.string(),
  scopes: z
    .union([z.enum(API_KEY_SCOPES), z.array(z.enum(API_KEY_SCOPES))])
    .optional()
    .transform((scopes) => (scopes === undefined ? [] : [scopes].flat())),
});

const installationForm = z.object({ installation_id: installationField });

const createWebhookForm = z.object({
  installation_id: installationField,
  url: z.string(),
  events: z
    .union([z.enum(WEBHOOK_EVENTS), z.array(z.enum(WEBHOOK_EVENTS))])
    .optional()
    .transform((events) => (events === undefined ? [] : [events].flat())),
});

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

  const readForm = async (c: Context, session: Session) => {
    const form = await c.req.parseBody({ all: true }).catch(() => ({}) as Record<string, never>);
    if (!verifyCsrf(deps.env.sessionSecret, session.token, form.csrf)) {
      throw new DomainError('forbidden', 'invalid csrf token');
    }
    return form;
  };

  const setupPage = (c: Context, session: Session, status: SetupStatus, flash?: FlashValue) => (
    <SetupPage
      lang={negotiateLanguage(c.req.header('accept-language'))}
      status={status}
      csrf={csrfToken(deps.env.sessionSecret, session.token)}
      newKey={flash?.kind === 'apiKey' ? flash : undefined}
      newWebhook={flash?.kind === 'webhook' ? flash : undefined}
    />
  );

  const parseForm = async <T extends z.ZodType>(c: Context, session: Session, schema: T) => {
    const parsed = schema.safeParse(await readForm(c, session));
    if (!parsed.success) {
      throw new DomainError('invalid_request', 'invalid form', parsed.error.issues);
    }
    return parsed.data as z.output<T>;
  };

  const flashAndRedirect = (
    c: Context,
    session: Session,
    installationId: number,
    value: FlashValue,
  ) => {
    setCookie(
      c,
      FLASH_COOKIE,
      sealFlash(deps.encryptionKey, session.token, installationId, value),
      {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: FLASH_PATH,
        maxAge: FLASH_SECONDS,
      },
    );
    c.header('Cache-Control', 'no-store');
    return c.redirect(`/setup?installation_id=${installationId}`, 303);
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

  app.get('/install.sh', (c) =>
    c.body(installScript, 200, {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    }),
  );

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
    const raw = getCookie(c, FLASH_COOKIE);
    if (!raw) return c.html(setupPage(c, session, result));
    deleteCookie(c, FLASH_COOKIE, { path: FLASH_PATH, secure: true });
    c.header('Cache-Control', 'no-store');
    const flash = openFlash(deps.encryptionKey, session.token, result.installationId, raw);
    return c.html(setupPage(c, session, result, flash));
  });

  app.post('/setup/api-keys', async (c) => {
    const session = await requireSession(c);
    const form = await parseForm(c, session, createKeyForm);
    const { installation_id: installationId, name, scopes } = form;
    const created = await createInstallationApiKey(deps, isMember, session.member, {
      installationId,
      name,
      scopes,
    });
    return flashAndRedirect(c, session, installationId, {
      kind: 'apiKey',
      name: name.trim(),
      key: created.key,
    });
  });

  app.post('/setup/api-keys/:id/revoke', async (c) => {
    const session = await requireSession(c);
    const { installation_id: installationId } = await parseForm(c, session, installationForm);
    await revokeInstallationApiKey(
      deps,
      isMember,
      session.member,
      installationId,
      c.req.param('id'),
    );
    return c.redirect(`/setup?installation_id=${installationId}`, 303);
  });

  app.post('/setup/webhooks', async (c) => {
    const session = await requireSession(c);
    const form = await parseForm(c, session, createWebhookForm);
    const { installation_id: installationId, url, events } = form;
    const created = await createWebhookEndpoint(deps, isMember, session.member, {
      installationId,
      url,
      events,
    });
    return flashAndRedirect(c, session, installationId, {
      kind: 'webhook',
      url: url.trim(),
      secret: created.secret,
    });
  });

  app.post('/setup/webhooks/:id/disable', async (c) => {
    const session = await requireSession(c);
    const { installation_id: installationId } = await parseForm(c, session, installationForm);
    await disableWebhookEndpoint(deps, isMember, session.member, installationId, c.req.param('id'));
    return c.redirect(`/setup?installation_id=${installationId}`, 303);
  });

  app.post('/setup/webhooks/:id/test', async (c) => {
    const session = await requireSession(c);
    const { installation_id: installationId } = await parseForm(c, session, installationForm);
    await sendTestEvent(deps, isMember, session.member, installationId, c.req.param('id'));
    return c.redirect(`/setup?installation_id=${installationId}`, 303);
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
