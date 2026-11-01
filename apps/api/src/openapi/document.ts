import type { OpenAPIHono } from '@hono/zod-openapi';
import aiAgents from '../../../../docs/api/guides/ai-agents.md' with { type: 'text' };
import authentication from '../../../../docs/api/guides/authentication.md' with { type: 'text' };
import errors from '../../../../docs/api/guides/errors.md' with { type: 'text' };
import pagination from '../../../../docs/api/guides/pagination.md' with { type: 'text' };
import rateLimits from '../../../../docs/api/guides/rate-limits.md' with { type: 'text' };
import versioning from '../../../../docs/api/guides/versioning.md' with { type: 'text' };
import webhooks from '../../../../docs/api/guides/webhooks.md' with { type: 'text' };
import rootPackage from '../../../../package.json' with { type: 'json' };

export const API_VERSION: string = rootPackage.version;

const overview = (docsUrl: string) =>
  `Standcast orchestrates the daily standup: it builds each person's draft from their GitHub activity, collects the confirmed dailies and posts one digest per team to chat.

Product documentation, guides and the standcast.yml reference: [Standcast docs](${docsUrl}/).`;

export const GUIDES = [
  authentication,
  aiAgents,
  errors,
  pagination,
  rateLimits,
  webhooks,
  versioning,
].map((guide) => guide.trim());

export type DocumentEnv = { publicUrl: string; supportEmail: string; docsUrl: string };

export function apiKeyScheme() {
  return {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'sck_',
    description:
      'API key created by an organization admin. Send it as `Authorization: Bearer sck_...`.',
  } as const;
}

export function sessionScheme() {
  return {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'sc_',
    description: 'Session token issued to the CLI, skill and MCP server after a GitHub login.',
  } as const;
}

export type DocumentSource = Pick<OpenAPIHono, 'getOpenAPI31Document'>;

export function publicDocument(app: DocumentSource, env: DocumentEnv) {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Standcast API',
      version: API_VERSION,
      contact: { email: env.supportEmail },
      description: [overview(env.docsUrl), ...GUIDES].join('\n\n'),
    },
    servers: [{ url: env.publicUrl }],
    tags: [
      { name: 'Organization', description: 'Organization data. Authenticated with an API key.' },
      {
        name: 'Webhooks',
        description: 'Signed events Standcast sends to the endpoints an admin registers.',
      },
      { name: 'Meta', description: 'Service metadata and health.' },
    ],
  });
}

export function internalDocument(app: DocumentSource, env: DocumentEnv) {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Standcast internal API',
      version: API_VERSION,
      contact: { email: env.supportEmail },
      description:
        'Routes used by the Standcast CLI, skill and MCP server. Authenticated with a session token. Not part of the public contract.',
    },
    servers: [{ url: env.publicUrl }],
  });
}
