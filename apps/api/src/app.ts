import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { onError } from './http/errors';
import { docsRoutes } from './routes/docs';
import { publicRoutes } from './routes/public';
import { v1Routes } from './routes/v1';
import { webRoutes } from './routes/web';
import { webhookRoutes } from './routes/webhooks';

export type AppOptions = { trustProxy?: boolean };

export function createApp(deps: Deps, options: AppOptions = {}): Hono {
  const app = new Hono();
  const publicApi = publicRoutes();
  const internalApi = v1Routes(deps, { trustProxy: options.trustProxy ?? false });
  app.onError(onError);
  app.route('/', publicApi);
  app.route('/', internalApi);
  app.route('/', docsRoutes(deps, { public: publicApi, internal: internalApi }));
  app.route('/webhooks', webhookRoutes(deps));
  app.route('/', webRoutes(deps));
  return app;
}
