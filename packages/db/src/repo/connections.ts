import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { decryptSecret, encryptSecret } from '../crypto';
import { connections, type Provider } from '../schema';

export type StoredConnection = {
  externalId: string;
  externalName: string | null;
  externalKey: string | null;
  secret: string;
  invalidatedAt: Date | null;
};

const byProvider = (installationId: number, provider: Provider) =>
  and(eq(connections.installationId, installationId), eq(connections.provider, provider));

export async function saveConnection(
  db: Db,
  installationId: number,
  provider: Provider,
  externalId: string,
  secret: string,
  key: Uint8Array,
  externalName?: string,
  externalKey?: string,
): Promise<void> {
  const secretCiphertext = encryptSecret(secret, key);
  const values = {
    externalId,
    externalName: externalName ?? null,
    externalKey: externalKey ?? null,
    secretCiphertext,
    invalidatedAt: null,
  };
  await db
    .insert(connections)
    .values({ installationId, provider, ...values })
    .onConflictDoUpdate({
      target: [connections.installationId, connections.provider],
      set: values,
    });
}

export async function getConnection(
  db: Db,
  installationId: number,
  provider: Provider,
  key: Uint8Array,
): Promise<StoredConnection | null> {
  const [row] = await db.select().from(connections).where(byProvider(installationId, provider));
  return row
    ? {
        externalId: row.externalId,
        externalName: row.externalName,
        externalKey: row.externalKey,
        secret: decryptSecret(row.secretCiphertext, key),
        invalidatedAt: row.invalidatedAt,
      }
    : null;
}

export async function getConnectionExternalId(
  db: Db,
  installationId: number,
  provider: Provider,
): Promise<string | null> {
  const [row] = await db
    .select({ externalId: connections.externalId })
    .from(connections)
    .where(byProvider(installationId, provider));
  return row?.externalId ?? null;
}

export async function markConnectionInvalid(
  db: Db,
  installationId: number,
  provider: Provider,
): Promise<void> {
  await db
    .update(connections)
    .set({ invalidatedAt: sql`now()` })
    .where(and(byProvider(installationId, provider), isNull(connections.invalidatedAt)));
}

export async function rotateConnectionSecret(
  db: Db,
  installationId: number,
  provider: Provider,
  key: Uint8Array,
  rotate: (secret: string) => Promise<string | null>,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${provider}-refresh:${installationId}`}))`,
    );
    const [row] = await tx
      .select({
        secretCiphertext: connections.secretCiphertext,
        invalidatedAt: connections.invalidatedAt,
      })
      .from(connections)
      .where(byProvider(installationId, provider));
    if (!row || row.invalidatedAt) return null;
    const current = decryptSecret(row.secretCiphertext, key);
    const next = await rotate(current);
    if (next === null) return current;
    await tx
      .update(connections)
      .set({ secretCiphertext: encryptSecret(next, key) })
      .where(byProvider(installationId, provider));
    return next;
  });
}
