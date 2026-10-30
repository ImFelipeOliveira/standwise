import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '@standwise/orchestrator';
import { sql } from 'drizzle-orm';
import type { GetClientIp } from '../middleware/rate-limit';
import { apiKeyScheme } from '../openapi/document';
import { HealthSchema } from '../openapi/schemas';
import { registerWebhooks } from '../openapi/webhooks';
import { orgRoutes } from './org';

const health = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Meta'],
  summary: 'Health check',
  description:
    'Returns `{ "ok": true }` while the service and its database are up, and `503` with `{ "ok": false }` when the database does not answer. Requires no authentication.\n\nRetorna `{ "ok": true }` enquanto o serviço e o banco estão no ar, e `503` com `{ "ok": false }` quando o banco não responde. Não exige autenticação.',
  responses: {
    200: {
      description: 'The service is up.',
      content: {
        'application/json': { schema: HealthSchema, example: { ok: true } },
      },
    },
    503: {
      description: 'The database does not answer.',
      content: {
        'application/json': { schema: HealthSchema, example: { ok: false } },
      },
    },
  },
});

export type PublicOptions = { getClientIp: GetClientIp };

export function publicRoutes(deps: Deps, options: PublicOptions): OpenAPIHono {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', apiKeyScheme());
  registerWebhooks(app);
  app.openapi(health, async (c) => {
    const up = await deps.db.execute(sql`select 1`).then(
      () => true,
      () => false,
    );
    return up ? c.json({ ok: true }, 200) : c.json({ ok: false }, 503);
  });
  app.route('/', orgRoutes(deps, options));
  return app;
}
