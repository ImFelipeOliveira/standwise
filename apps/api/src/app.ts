import type { Deps } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { v1Routes } from './routes/v1';

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/v1', v1Routes(deps));
  return app;
}
