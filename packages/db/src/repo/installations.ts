import type { ConfigError, StandwiseConfig } from '@standwise/core';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type InstallationRow, installations } from '../schema';

export async function upsertInstallation(
  db: Db,
  i: {
    id: number;
    accountLogin: string;
    accountType: 'Organization' | 'User';
    accountId?: number | null;
  },
): Promise<void> {
  await db
    .insert(installations)
    .values(i)
    .onConflictDoUpdate({
      target: installations.id,
      set: {
        accountLogin: i.accountLogin,
        accountType: i.accountType,
        ...(i.accountId !== undefined ? { accountId: i.accountId } : {}),
        updatedAt: sql`now()`,
      },
    });
}

export async function deleteInstallation(db: Db, id: number): Promise<void> {
  await db.delete(installations).where(eq(installations.id, id));
}

export type InstallationConfigResult =
  | { status: 'configured'; config: StandwiseConfig }
  | { status: 'invalid'; errors: ConfigError[] }
  | { status: 'unconfigured'; reason: string };

export async function setInstallationConfig(
  db: Db,
  id: number,
  r: InstallationConfigResult,
): Promise<void> {
  const set =
    r.status === 'configured'
      ? { status: r.status, config: r.config, configErrors: null, unconfiguredReason: null }
      : r.status === 'invalid'
        ? { status: r.status, configErrors: r.errors }
        : { status: r.status, configErrors: null, unconfiguredReason: r.reason };
  await db
    .update(installations)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(installations.id, id));
}

const OPERATIONAL_STATUSES: InstallationRow['status'][] = ['configured', 'invalid'];

export function operationalConfig(
  installation: Pick<InstallationRow, 'status' | 'config'> | null | undefined,
): StandwiseConfig | null {
  if (!installation?.config) return null;
  return OPERATIONAL_STATUSES.includes(installation.status) ? installation.config : null;
}

export async function listOperationalInstallations(
  db: Db,
): Promise<{ id: number; accountLogin: string; config: StandwiseConfig }[]> {
  const rows = await db
    .select()
    .from(installations)
    .where(inArray(installations.status, OPERATIONAL_STATUSES));
  return rows.flatMap((r) => {
    const config = operationalConfig(r);
    return config ? [{ id: r.id, accountLogin: r.accountLogin, config }] : [];
  });
}

export async function getInstallation(db: Db, id: number): Promise<InstallationRow | null> {
  const [row] = await db.select().from(installations).where(eq(installations.id, id));
  return row ?? null;
}
