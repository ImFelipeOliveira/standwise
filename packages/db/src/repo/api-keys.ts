import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type ApiKeyScope, apiKeys } from '../schema';

const KEY_PREFIX = 'sck_';
const DISPLAY_PREFIX_LENGTH = 8;
const LAST_USED_RESOLUTION_SECONDS = 60;

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export async function createApiKey(
  db: Db,
  p: { installationId: number; name: string; scopes: ApiKeyScope[]; createdBy: string },
): Promise<{ id: string; key: string }> {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      installationId: p.installationId,
      name: p.name,
      prefix: key.slice(KEY_PREFIX.length, KEY_PREFIX.length + DISPLAY_PREFIX_LENGTH),
      secretHash: hash(key),
      scopes: p.scopes,
      createdBy: p.createdBy,
    })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error('createApiKey returned no row');
  return { id: row.id, key };
}

export async function resolveApiKey(
  db: Db,
  key: string,
): Promise<{ id: string; installationId: number; scopes: ApiKeyScope[] } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const secretHash = hash(key);
  const [row] = await db
    .select({ id: apiKeys.id, installationId: apiKeys.installationId, scopes: apiKeys.scopes })
    .from(apiKeys)
    .where(and(eq(apiKeys.secretHash, secretHash), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  await db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, row.id),
        sql`(${apiKeys.lastUsedAt} IS NULL OR ${apiKeys.lastUsedAt} < now() - make_interval(secs => ${LAST_USED_RESOLUTION_SECONDS}))`,
      ),
    );
  return row;
}

export async function listApiKeys(db: Db, installationId: number): Promise<ApiKeySummary[]> {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.installationId, installationId))
    .orderBy(desc(apiKeys.createdAt), apiKeys.id);
}

export async function revokeApiKey(db: Db, installationId: number, id: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.installationId, installationId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}
