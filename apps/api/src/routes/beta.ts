import { type Deps, DomainError, submitBetaRequest } from '@standcast/orchestrator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { BETA_LIMIT, type GetClientIp, ipRateLimit } from '../middleware/rate-limit';

export const BETA_BODY_LIMIT_BYTES = 8 * 1024;

type Locale = 'en' | 'pt-BR';

function localeOf(error: DomainError): Locale {
  const locale = (error.details as { locale?: unknown } | undefined)?.locale;
  return locale === 'pt-BR' ? 'pt-BR' : 'en';
}

export function betaRoutes(deps: Deps, options: { getClientIp: GetClientIp }): Hono {
  const app = new Hono();
  app.post(
    '/beta',
    ipRateLimit(deps, options.getClientIp, 'beta', BETA_LIMIT),
    bodyLimit({
      maxSize: BETA_BODY_LIMIT_BYTES,
      onError: (c) => c.redirect(`${deps.env.landingUrl}/#beta-invalid`, 303),
    }),
    async (c) => {
      const form = await c.req.parseBody({ all: true }).catch(() => ({}) as Record<string, never>);
      try {
        const { locale } = await submitBetaRequest(deps, form);
        const prefix = locale === 'pt-BR' ? '/pt-BR' : '';
        return c.redirect(`${deps.env.docsUrl}${prefix}/admin/install`, 303);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'invalid_beta_request') {
          const prefix = localeOf(error) === 'pt-BR' ? '/pt-BR' : '';
          return c.redirect(`${deps.env.landingUrl}${prefix}/#beta-invalid`, 303);
        }
        throw error;
      }
    },
  );
  return app;
}
