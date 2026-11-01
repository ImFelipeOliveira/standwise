import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { pingDatabase } from '@standcast/db';
import type { Deps } from '@standcast/orchestrator';
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

export const HEALTH_TIMEOUT_MS = 2000;

export type PublicOptions = { getClientIp: GetClientIp; healthTimeoutMs?: number };

function createDatabaseProbe(deps: Deps, timeoutMs: number): () => Promise<boolean> {
  let pending: { query: Promise<boolean>; startedAt: number } | undefined;
  const run = () => {
    const entry = {
      startedAt: Date.now(),
      query: Promise.resolve()
        .then(() => pingDatabase(deps.db))
        .then(
          () => true,
          () => false,
        )
        .finally(() => {
          if (pending === entry) pending = undefined;
        }),
    };
    return entry;
  };
  return async () => {
    if (!pending || Date.now() - pending.startedAt > 5 * timeoutMs) pending = run();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([pending.query, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function publicRoutes(deps: Deps, options: PublicOptions): OpenAPIHono {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', apiKeyScheme());
  registerWebhooks(app);
  const databaseUp = createDatabaseProbe(deps, options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);
  app.openapi(health, async (c) => {
    const up = await databaseUp();
    return up ? c.json({ ok: true }, 200) : c.json({ ok: false }, 503);
  });
  app.route('/', orgRoutes(deps, options));
  return app;
}
