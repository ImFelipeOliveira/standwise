import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Scalar } from '@scalar/hono-api-reference';
import type { Deps } from '@standwise/orchestrator';
import { type Context, Hono } from 'hono';
import { serveStatic } from 'hono/bun';
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

export const DOCS_SITE_DIR = join(import.meta.dir, '../../../../docs/site/.vitepress/dist');

const SITE_PREFIX = /^\/docs/;
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '')
        .digest('base64')}'`,
  );
}

function siteCsp(hashes: string[]): string {
  return [
    "default-src 'none'",
    ["script-src 'self'", ...hashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function siteRoutes(siteDir: string): Hono {
  const app = new Hono();
  const hashes = new Map<string, string[]>();
  const headers = async (path: string, c: Context) => {
    if (!path.endsWith('.html')) {
      c.header('Content-Security-Policy', siteCsp([]));
      return;
    }
    let pageHashes = hashes.get(path);
    if (!pageHashes) {
      pageHashes = inlineScriptHashes(await Bun.file(path).text());
      hashes.set(path, pageHashes);
    }
    c.header('Content-Security-Policy', siteCsp(pageHashes));
  };
  const strip = (path: string) => path.replace(SITE_PREFIX, '');
  app.use('/docs/*', serveStatic({ root: siteDir, rewriteRequestPath: strip, onFound: headers }));
  app.use(
    '/docs/*',
    serveStatic({
      root: siteDir,
      rewriteRequestPath: (path) => `${strip(path)}.html`,
      onFound: headers,
    }),
  );
  return app;
}

export function docsRoutes(
  deps: Deps,
  apps: { public: DocumentSource; internal: DocumentSource },
  getClientIp: GetClientIp,
  siteDir: string = DOCS_SITE_DIR,
): Hono {
  const env: DocumentEnv = { publicUrl: deps.env.publicUrl, supportEmail: deps.env.supportEmail };
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
    '/docs/api',
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
  app.get('/docs/api/', (c) => c.redirect('/docs/api', 301));
  app.get('/docs', (c) => c.redirect('/docs/'));
  app.route('/', siteRoutes(siteDir));
  return app;
}
