import { Scalar } from '@scalar/hono-api-reference';
import type { Deps } from '@standcast/orchestrator';
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

function llmsText(publicUrl: string, docsUrl: string): string {
  return `# Standcast API

> Standcast orchestrates a team daily standup from GitHub to Slack. The public API is read-only: it exposes organization data to integrators. Dailies are never sent through the public API; they are sent through the MCP server or the CLI.

## API

- [OpenAPI document](${publicUrl}/openapi.json): the machine-readable description of the public API
- [API reference](${publicUrl}/reference): interactive reference

## Documentation

- [Docs index for agents](${docsUrl}/llms.txt): every documentation page as Markdown
- [Full docs in one file](${docsUrl}/llms-full.txt): the whole documentation in a single file
- [API overview](${docsUrl}/api/overview.md): authentication, pagination, rate limits and errors
- [Webhooks](${docsUrl}/api/webhooks.md): events, signatures and retries
`;
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
  app.get('/llms.txt', (c) =>
    c.text(llmsText(deps.env.publicUrl, deps.env.docsUrl), 200, {
      'content-type': 'text/plain; charset=utf-8',
    }),
  );
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
      return { url: '/openapi.json', pageTitle: 'Standcast API', cdn: SCALAR_CDN, nonce };
    }),
  );
  app.get('/reference/', (c) => c.redirect('/reference', 301));
  app.get('/docs/api', (c) => c.redirect('/reference', 301));
  app.get('/docs/api/', (c) => c.redirect('/reference', 301));
  app.get('/docs', (c) => c.redirect(docsLocation(deps.env.docsUrl, c.req.url), 301));
  app.get('/docs/*', (c) => c.redirect(docsLocation(deps.env.docsUrl, c.req.url), 301));
  return app;
}
