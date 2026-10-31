import { Scalar } from '@scalar/hono-api-reference';
import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import {
  type GetClientIp,
  IP_LIMIT,
  ipRateLimit,
  subjectRateLimit,
} from '../middleware/rate-limit';
import { sessionAuth } from '../middleware/session-auth';
import {
  type DocumentEnv,
  type DocumentSource,
  internalDocument,
  publicDocument,
} from '../openapi/document';

const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0';

function docsLocation(docsUrl: string, requestUrl: string): string {
  const { pathname, search } = new URL(requestUrl);
  const rest = pathname.replace(/^\/docs/, '').replace(/^\/+/, '');
  return `${docsUrl}/${rest}${search}`;
}

export function docsRoutes(
  deps: Deps,
  apps: { public: DocumentSource; internal: DocumentSource },
  getClientIp: GetClientIp,
): Hono {
  const env: DocumentEnv = {
    publicUrl: deps.env.publicUrl,
    supportEmail: deps.env.supportEmail,
    docsUrl: deps.env.docsUrl,
  };
  const app = new Hono();
  app.get('/openapi.json', (c) => c.json(publicDocument(apps.public, env)));
  app.get(
    '/openapi.internal.json',
    ipRateLimit(deps, getClientIp, 'api', IP_LIMIT),
    sessionAuth(deps, getClientIp),
    subjectRateLimit(deps),
    (c) => c.json(internalDocument(apps.internal, env)),
  );
  app.get(
    '/reference',
    Scalar((c) => {
      const nonce = btoa(crypto.randomUUID());
      const publicOrigin = new URL(deps.env.publicUrl).origin;
      const connect =
        publicOrigin === new URL(c.req.url).origin ? "'self'" : `'self' ${publicOrigin}`;
      c.header(
        'Content-Security-Policy',
        [
          "default-src 'none'",
          `script-src 'nonce-${nonce}' ${SCALAR_CDN}`,
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' https://fonts.scalar.com data:",
          "img-src 'self' data: https:",
          `connect-src ${connect}`,
          "form-action 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
        ].join('; '),
      );
      return { url: '/openapi.json', pageTitle: 'Standwise API', cdn: SCALAR_CDN, nonce };
    }),
  );
  app.get('/reference/', (c) => c.redirect('/reference', 301));
  app.get('/docs/api', (c) => c.redirect('/reference', 301));
  app.get('/docs/api/', (c) => c.redirect('/reference', 301));
  app.get('/docs', (c) => c.redirect(docsLocation(deps.env.docsUrl, c.req.url), 301));
  app.get('/docs/*', (c) => c.redirect(docsLocation(deps.env.docsUrl, c.req.url), 301));
  return app;
}
