import { and, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { decryptSecret, encryptSecret } from '../crypto';
import { connections, type Provider } from '../schema';

export async function saveConnection(
  db: Db,
  installationId: number,
  provider: Provider,
  externalId: string,
  secret: string,
  key: Uint8Array,
): Promise<void> {
  const secretCiphertext = encryptSecret(secret, key);
  await db
    .insert(connections)
    .values({ installationId, provider, externalId, secretCiphertext })
    .onConflictDoUpdate({
      target: [connections.installationId, connections.provider],
      set: { externalId, secretCiphertext },
    });
}

export async function getConnection(
  db: Db,
  installationId: number,
  provider: Provider,
  key: Uint8Array,
): Promise<{ externalId: string; secret: string } | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.installationId, installationId), eq(connections.provider, provider)));
  return row
    ? { externalId: row.externalId, secret: decryptSecret(row.secretCiphertext, key) }
    : null;
}
