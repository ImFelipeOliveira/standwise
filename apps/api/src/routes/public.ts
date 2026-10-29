import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { apiKeyScheme } from '../openapi/document';
import { HealthSchema } from '../openapi/schemas';

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

export function publicRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', apiKeyScheme());
  app.openapi(health, (c) => c.json({ ok: true }, 200));
  return app;
}
