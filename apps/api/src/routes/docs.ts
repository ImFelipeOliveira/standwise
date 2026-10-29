import { Scalar } from '@scalar/hono-api-reference';
import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { sessionAuth } from '../middleware/session-auth';
import {
  type DocumentEnv,
  type DocumentSource,
  internalDocument,
  publicDocument,
} from '../openapi/document';

export function docsRoutes(
  deps: Deps,
  apps: { public: DocumentSource; internal: DocumentSource },
): Hono {
  const env: DocumentEnv = { publicUrl: deps.env.publicUrl, supportEmail: deps.env.supportEmail };
  const app = new Hono();
  app.get('/openapi.json', (c) => c.json(publicDocument(apps.public, env)));
  app.get('/openapi.internal.json', sessionAuth(deps), (c) =>
    c.json(internalDocument(apps.internal, env)),
  );
  app.get('/docs/api', Scalar({ url: '/openapi.json', pageTitle: 'Standwise API' }));
  app.get('/docs', (c) => c.redirect('/docs/api'));
  return app;
}
