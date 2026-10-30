import { Webhooks } from '@octokit/webhooks';
import { type Deps, type GitHubEventPayload, handleGitHubEvent } from '@standwise/orchestrator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

export const WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;

export function webhookRoutes(deps: Deps): Hono {
  const webhooks = new Webhooks({ secret: deps.env.webhookSecret });
  const app = new Hono();
  app.post(
    '/github',
    bodyLimit({
      maxSize: WEBHOOK_BODY_LIMIT_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'payload_too_large', message: 'payload too large' } }, 413),
    }),
    async (c) => {
      const body = await c.req.text();
      const signature = c.req.header('x-hub-signature-256');
      if (!signature || !(await webhooks.verify(body, signature).catch(() => false))) {
        return c.json({ error: { code: 'invalid_signature', message: 'invalid signature' } }, 401);
      }
      let payload: GitHubEventPayload;
      try {
        payload = JSON.parse(body) as GitHubEventPayload;
      } catch {
        return c.json({ error: { code: 'invalid_request', message: 'invalid json' } }, 422);
      }
      await handleGitHubEvent(deps, c.req.header('x-github-event'), payload);
      return c.json({ accepted: true }, 202);
    },
  );
  return app;
}
