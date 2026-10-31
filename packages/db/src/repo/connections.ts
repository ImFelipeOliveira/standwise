import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { decryptSecret, encryptSecret } from '../crypto';
import { connections, memberIdentities, type Provider } from '../schema';

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
  await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ externalId: connections.externalId })
      .from(connections)
      .where(byProvider(installationId, provider))
      .for('update');
    await tx
      .insert(connections)
      .values({ installationId, provider, ...values })
      .onConflictDoUpdate({
        target: [connections.installationId, connections.provider],
        set: values,
      });
    if (previous && previous.externalId !== externalId) {
      await tx
        .delete(memberIdentities)
        .where(
          and(
            eq(memberIdentities.installationId, installationId),
            eq(memberIdentities.provider, provider),
          ),
        );
    }
  });
}

export async function writeIdentityIfConnected(
  db: Db,
  input: {
    installationId: number;
    memberId: string;
    provider: Provider;
    connectionExternalId: string;
    externalId: string | null;
  },
): Promise<boolean> {
  const { installationId, memberId, provider, connectionExternalId, externalId } = input;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ externalId: connections.externalId })
      .from(connections)
      .where(
        and(byProvider(installationId, provider), eq(connections.externalId, connectionExternalId)),
      )
      .for('share');
    if (!current) return false;
    if (externalId === null) {
      await tx
        .delete(memberIdentities)
        .where(
          and(
            eq(memberIdentities.installationId, installationId),
            eq(memberIdentities.memberId, memberId),
            eq(memberIdentities.provider, provider),
          ),
        );
      return true;
    }
    await tx
      .insert(memberIdentities)
      .values({ installationId, memberId, provider, externalId })
      .onConflictDoUpdate({
        target: [
          memberIdentities.installationId,
          memberIdentities.memberId,
          memberIdentities.provider,
        ],
        set: { externalId },
      });
    return true;
  });
}

export async function updateConnectionDetails(
  db: Db,
  installationId: number,
  provider: Provider,
  externalId: string,
  details: { externalName: string; externalKey: string },
): Promise<boolean> {
  const updated = await db
    .update(connections)
    .set(details)
    .where(and(byProvider(installationId, provider), eq(connections.externalId, externalId)))
    .returning({ externalId: connections.externalId });
  return updated.length > 0;
}

export type ConnectionSnapshot = StoredConnection & { ciphertext: string };

export type ConnectionInfo = Omit<StoredConnection, 'secret'>;

type ConnectionRow = typeof connections.$inferSelect;

const snapshotOf = (row: ConnectionRow, key: Uint8Array): ConnectionSnapshot => ({
  externalId: row.externalId,
  externalName: row.externalName,
  externalKey: row.externalKey,
  secret: decryptSecret(row.secretCiphertext, key),
  invalidatedAt: row.invalidatedAt,
  ciphertext: row.secretCiphertext,
});

export async function getConnectionSnapshot(
  db: Db,
  installationId: number,
  provider: Provider,
  key: Uint8Array,
): Promise<ConnectionSnapshot | null> {
  const [row] = await db.select().from(connections).where(byProvider(installationId, provider));
  return row ? snapshotOf(row, key) : null;
}

export async function getConnection(
  db: Db,
  installationId: number,
  provider: Provider,
  key: Uint8Array,
): Promise<StoredConnection | null> {
  const snapshot = await getConnectionSnapshot(db, installationId, provider, key);
  if (!snapshot) return null;
  const { ciphertext: _ciphertext, ...connection } = snapshot;
  return connection;
}

export async function getConnectionInfo(
  db: Db,
  installationId: number,
  provider: Provider,
): Promise<ConnectionInfo | null> {
  const [row] = await db
    .select({
      externalId: connections.externalId,
      externalName: connections.externalName,
      externalKey: connections.externalKey,
      invalidatedAt: connections.invalidatedAt,
    })
    .from(connections)
    .where(byProvider(installationId, provider));
  return row ?? null;
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
  expectedCiphertext?: string,
): Promise<void> {
  await db
    .update(connections)
    .set({ invalidatedAt: sql`now()` })
    .where(
      and(
        byProvider(installationId, provider),
        isNull(connections.invalidatedAt),
        expectedCiphertext === undefined
          ? undefined
          : eq(connections.secretCiphertext, expectedCiphertext),
      ),
    );
}

const ROTATION_LOCK_TIMEOUT_MS = 15_000;

export async function rotateConnectionSecret(
  db: Db,
  installationId: number,
  provider: Provider,
  key: Uint8Array,
  rotate: (secret: string, ciphertext: string) => Promise<string | null>,
  options: { lockTimeoutMs?: number } = {},
): Promise<ConnectionSnapshot | null> {
  return db.transaction(async (tx) => {
    const lockTimeout = `${options.lockTimeoutMs ?? ROTATION_LOCK_TIMEOUT_MS}ms`;
    await tx.execute(sql`select set_config('lock_timeout', ${lockTimeout}, true)`);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${provider}-refresh:${installationId}`}))`,
    );
    const read = async () => {
      const [row] = await tx.select().from(connections).where(byProvider(installationId, provider));
      return row && !row.invalidatedAt ? snapshotOf(row, key) : null;
    };
    const current = await read();
    if (!current) return null;
    const next = await rotate(current.secret, current.ciphertext);
    if (next === null) return current;
    const ciphertext = encryptSecret(next, key);
    const updated = await tx
      .update(connections)
      .set({ secretCiphertext: ciphertext })
      .where(
        and(
          byProvider(installationId, provider),
          isNull(connections.invalidatedAt),
          eq(connections.secretCiphertext, current.ciphertext),
        ),
      )
      .returning();
    const [row] = updated;
    return row ? snapshotOf(row, key) : read();
  });
}
