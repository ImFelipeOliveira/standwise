import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { onError } from './http/errors';
import type { GetClientIp } from './middleware/rate-limit';
import { docsRoutes } from './routes/docs';
import { publicRoutes } from './routes/public';
import { v1Routes } from './routes/v1';
import { webRoutes } from './routes/web';
import { webhookRoutes } from './routes/webhooks';

export type AppOptions = { getClientIp: GetClientIp; docsDir?: string };

export function createApp(deps: Deps, options: AppOptions): Hono {
  const app = new Hono();
  const publicApi = publicRoutes(deps, { getClientIp: options.getClientIp });
  const internalApi = v1Routes(deps, { getClientIp: options.getClientIp });
  app.onError(onError);
  app.route('/', internalApi);
  app.route('/', publicApi);
  app.route(
    '/',
    docsRoutes(
      deps,
      { public: publicApi, internal: internalApi },
      options.getClientIp,
      options.docsDir,
    ),
  );
  app.route('/webhooks', webhookRoutes(deps));
  app.route('/', webRoutes(deps, { getClientIp: options.getClientIp }));
  return app;
}
