import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { onError } from './http/errors';
import { v1Routes } from './routes/v1';
import { webRoutes } from './routes/web';
import { webhookRoutes } from './routes/webhooks';

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/v1', v1Routes(deps));
  app.route('/webhooks', webhookRoutes(deps));
  app.route('/', webRoutes(deps));
  return app;
}
