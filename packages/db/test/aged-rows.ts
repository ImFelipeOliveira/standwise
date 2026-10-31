import { inArray } from 'drizzle-orm';
import { deliveries, sessions, suggestions } from '../src/schema';
import { db } from './setup';

export type AgedSession = {
  tokenHash: string;
  memberId: string;
  kind: 'cli' | 'web';
  createdAt: Date;
  lastUsedAt: Date;
};

export async function insertAgedSessions(rows: AgedSession[]): Promise<void> {
  await db.insert(sessions).values(rows);
}

export async function insertAgedSuggestion(row: {
  installationId: number;
  memberId: string;
  fingerprint: string;
  state: 'pending' | 'confirmed' | 'ignored' | 'resolved';
  createdAt: Date;
  decidedAt: Date | null;
}): Promise<void> {
  await db.insert(suggestions).values({
    ...row,
    kind: 'pr_no_review',
    ref: { kind: 'pull_request', url: `https://github.com/acme/api/pull/${row.fingerprint}` },
  });
}

export async function listSessionTokens(): Promise<string[]> {
  return (await db.select().from(sessions)).map((r) => r.tokenHash).sort();
}

export async function listSuggestionFingerprints(): Promise<string[]> {
  return (await db.select().from(suggestions)).map((r) => r.fingerprint).sort();
}

export async function ageDeliveries(subjects: string[], updatedAt: Date): Promise<void> {
  await db.update(deliveries).set({ updatedAt }).where(inArray(deliveries.subject, subjects));
}
