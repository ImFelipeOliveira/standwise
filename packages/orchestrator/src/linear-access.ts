import { getConnection, markConnectionInvalid, rotateConnectionSecret } from '@standwise/db';
import {
  createLinearClient,
  LinearAuthError,
  type LinearClient,
  type LinearTokens,
} from '@standwise/linear';
import type { Deps } from './deps';
import { logError } from './log-error';

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export type LinearAccessDeps = Pick<Deps, 'db' | 'encryptionKey' | 'linear' | 'now'> & {
  env: Pick<Deps['env'], 'linearClientId' | 'linearClientSecret'>;
};

export type LinearAccess = {
  client: LinearClient;
  organization: { id: string; urlKey: string };
};

const stringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function parseTokens(secret: string): LinearTokens | null {
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { accessToken, refreshToken, expiresAt } = value as Record<string, unknown>;
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  if (!stringOrNull(refreshToken) || !stringOrNull(expiresAt)) return null;
  return { accessToken, refreshToken, expiresAt };
}

function needsRefresh(
  tokens: LinearTokens,
  now: Date,
): tokens is LinearTokens & {
  refreshToken: string;
  expiresAt: string;
} {
  if (tokens.refreshToken === null || tokens.expiresAt === null) return false;
  return Date.parse(tokens.expiresAt) - now.getTime() <= REFRESH_WINDOW_MS;
}

async function refreshTokens(
  deps: LinearAccessDeps,
  installationId: number,
): Promise<LinearTokens | null> {
  const secret = await rotateConnectionSecret(
    deps.db,
    installationId,
    'linear',
    deps.encryptionKey,
    async (current) => {
      const tokens = parseTokens(current);
      if (!tokens || !needsRefresh(tokens, deps.now())) return null;
      const next = await deps.linear.refreshToken(
        {
          clientId: deps.env.linearClientId,
          clientSecret: deps.env.linearClientSecret,
          refreshToken: tokens.refreshToken,
        },
        deps.linear.fetch,
      );
      return JSON.stringify({ ...next, refreshToken: next.refreshToken ?? tokens.refreshToken });
    },
  );
  return secret === null ? null : parseTokens(secret);
}

export async function linearClientFor(
  deps: LinearAccessDeps,
  installationId: number,
): Promise<LinearAccess | null> {
  const connection = await getConnection(deps.db, installationId, 'linear', deps.encryptionKey);
  if (!connection || connection.invalidatedAt) return null;
  let tokens = parseTokens(connection.secret);
  if (!tokens || !connection.externalKey) {
    logError('linear connection unreadable', new Error('invalid stored linear connection'), {
      installationId: String(installationId),
    });
    await markConnectionInvalid(deps.db, installationId, 'linear');
    return null;
  }
  if (needsRefresh(tokens, deps.now())) {
    try {
      tokens = await refreshTokens(deps, installationId);
    } catch (error) {
      if (!(error instanceof LinearAuthError)) throw error;
      logError('linear token refresh rejected', error, { installationId: String(installationId) });
      await markConnectionInvalid(deps.db, installationId, 'linear');
      return null;
    }
    if (!tokens) return null;
  }
  return {
    client: createLinearClient(tokens.accessToken, deps.linear.fetch),
    organization: { id: connection.externalId, urlKey: connection.externalKey },
  };
}
