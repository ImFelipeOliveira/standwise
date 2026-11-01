import {
  type ConnectionSnapshot,
  getConnectionSnapshot,
  markConnectionInvalid,
  rotateConnectionSecret,
  updateConnectionDetails,
} from '@standcast/db';
import {
  createLinearClient,
  getOrganization,
  LinearAuthError,
  type LinearClient,
  type LinearTokens,
} from '@standcast/linear';
import type { Deps } from './deps';
import { logError } from './log-error';

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export type LinearAccessDeps = Pick<Deps, 'db' | 'encryptionKey' | 'linear' | 'now'> & {
  env: Pick<Deps['env'], 'linearClientId' | 'linearClientSecret'>;
};

export type LinearAccess = {
  client: LinearClient;
  organization: { id: string; urlKey: string };
  invalidate: () => Promise<void>;
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

class UnreadableLinearConnection extends Error {
  constructor() {
    super('invalid stored linear connection');
    this.name = 'UnreadableLinearConnection';
  }
}

function readable(
  connection: ConnectionSnapshot,
): { tokens: LinearTokens; organization: LinearAccess['organization'] } | null {
  const tokens = parseTokens(connection.secret);
  if (!tokens || !connection.externalKey) return null;
  return { tokens, organization: { id: connection.externalId, urlKey: connection.externalKey } };
}

async function invalidate(
  deps: LinearAccessDeps,
  installationId: number,
  ciphertext: string,
  label: string,
  error: unknown,
): Promise<null> {
  logError(label, error, { installationId: String(installationId) });
  await markConnectionInvalid(deps.db, installationId, 'linear', ciphertext);
  return null;
}

async function stillValid(
  deps: LinearAccessDeps,
  installationId: number,
): Promise<ConnectionSnapshot | null> {
  const current = await getConnectionSnapshot(
    deps.db,
    installationId,
    'linear',
    deps.encryptionKey,
  );
  if (!current || current.invalidatedAt) return null;
  const expiresAt = parseTokens(current.secret)?.expiresAt;
  if (!expiresAt || Date.parse(expiresAt) <= deps.now().getTime()) return null;
  return current;
}

async function healWorkspace(
  deps: LinearAccessDeps,
  installationId: number,
  connection: ConnectionSnapshot,
  accessToken: string,
): Promise<ConnectionSnapshot> {
  try {
    const organization = await getOrganization(createLinearClient(accessToken, deps.linear.fetch));
    if (organization.id !== connection.externalId) return connection;
    const details = { externalName: organization.name, externalKey: organization.urlKey };
    const updated = await updateConnectionDetails(
      deps.db,
      installationId,
      'linear',
      connection.externalId,
      details,
    );
    return updated ? { ...connection, ...details } : connection;
  } catch (error) {
    logError('linear workspace refresh failed', error, { installationId: String(installationId) });
    return connection;
  }
}

async function refreshConnection(
  deps: LinearAccessDeps,
  installationId: number,
  stale: ConnectionSnapshot,
): Promise<ConnectionSnapshot | null> {
  let used = stale.ciphertext;
  let rotatedAccessToken: string | null = null;
  let connection: ConnectionSnapshot | null;
  try {
    connection = await rotateConnectionSecret(
      deps.db,
      installationId,
      'linear',
      deps.encryptionKey,
      async (secret, ciphertext) => {
        used = ciphertext;
        const tokens = parseTokens(secret);
        if (!tokens) throw new UnreadableLinearConnection();
        if (!needsRefresh(tokens, deps.now())) return null;
        const next = await deps.linear.refreshToken(
          {
            clientId: deps.env.linearClientId,
            clientSecret: deps.env.linearClientSecret,
            refreshToken: tokens.refreshToken,
          },
          deps.linear.fetch,
        );
        rotatedAccessToken = next.accessToken;
        return JSON.stringify({ ...next, refreshToken: next.refreshToken ?? tokens.refreshToken });
      },
    );
  } catch (error) {
    if (error instanceof UnreadableLinearConnection) {
      return invalidate(deps, installationId, used, 'linear connection unreadable', error);
    }
    if (error instanceof LinearAuthError) {
      return invalidate(deps, installationId, used, 'linear token refresh rejected', error);
    }
    logError('linear token refresh failed', error, { installationId: String(installationId) });
    const current = await stillValid(deps, installationId);
    if (current) return current;
    throw error;
  }
  if (!connection || rotatedAccessToken === null) return connection;
  if (parseTokens(connection.secret)?.accessToken !== rotatedAccessToken) return connection;
  return healWorkspace(deps, installationId, connection, rotatedAccessToken);
}

export async function linearClientFor(
  deps: LinearAccessDeps,
  installationId: number,
): Promise<LinearAccess | null> {
  let connection = await getConnectionSnapshot(
    deps.db,
    installationId,
    'linear',
    deps.encryptionKey,
  );
  if (!connection || connection.invalidatedAt) return null;
  let access = readable(connection);
  if (access && needsRefresh(access.tokens, deps.now())) {
    connection = await refreshConnection(deps, installationId, connection);
    if (!connection) return null;
    access = readable(connection);
  }
  if (!access) {
    return invalidate(
      deps,
      installationId,
      connection.ciphertext,
      'linear connection unreadable',
      new UnreadableLinearConnection(),
    );
  }
  const { ciphertext } = connection;
  return {
    client: createLinearClient(access.tokens.accessToken, deps.linear.fetch),
    organization: access.organization,
    invalidate: () => markConnectionInvalid(deps.db, installationId, 'linear', ciphertext),
  };
}
