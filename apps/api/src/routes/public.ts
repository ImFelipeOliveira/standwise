import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '@standwise/orchestrator';
import type { GetClientIp } from '../middleware/rate-limit';
import { apiKeyScheme } from '../openapi/document';
import { HealthSchema } from '../openapi/schemas';
import { orgRoutes } from './org';

const health = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Meta'],
  summary: 'Health check',
  description:
    'Returns `{ "ok": true }` while the service is up. Requires no authentication.\n\nRetorna `{ "ok": true }` enquanto o serviço está no ar. Não exige autenticação.',
  responses: {
    200: {
      description: 'The service is up.',
      content: {
        'application/json': { schema: HealthSchema, example: { ok: true } },
      },
    },
  },
});

export type PublicOptions = { getClientIp: GetClientIp };

export function publicRoutes(deps: Deps, options: PublicOptions): OpenAPIHono {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', apiKeyScheme());
  app.openapi(health, (c) => c.json({ ok: true }, 200));
  app.route('/', orgRoutes(deps, options));
  return app;
}
