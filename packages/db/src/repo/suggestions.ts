import type { Ref, Signal, SignalKind } from '@standwise/core';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { type SuggestionState, suggestions } from '../schema';

export type SuggestionRow = {
  id: string;
  kind: SignalKind;
  ref: Ref;
  fingerprint: string;
  state: SuggestionState;
  createdAt: Date;
};

const columns = {
  id: suggestions.id,
  kind: suggestions.kind,
  ref: suggestions.ref,
  fingerprint: suggestions.fingerprint,
  state: suggestions.state,
  createdAt: suggestions.createdAt,
};

export async function syncSuggestions(
  db: Db,
  installationId: number,
  memberId: string,
  kinds: SignalKind[],
  signals: Signal[],
): Promise<{ created: SuggestionRow[] }> {
  const unique = [...new Map(signals.map((s) => [s.fingerprint, s])).values()];
  const created =
    unique.length === 0
      ? []
      : await db
          .insert(suggestions)
          .values(
            unique.map((s) => ({
              installationId,
              memberId,
              kind: s.kind,
              ref: s.ref,
              fingerprint: s.fingerprint,
              state: 'pending' as const,
            })),
          )
          .onConflictDoNothing({
            target: [suggestions.installationId, suggestions.memberId, suggestions.fingerprint],
          })
          .returning(columns);

  if (kinds.length > 0) {
    const fingerprints = unique.map((s) => s.fingerprint);
    await db
      .update(suggestions)
      .set({ state: 'resolved', decidedAt: sql`now()` })
      .where(
        and(
          eq(suggestions.installationId, installationId),
          eq(suggestions.memberId, memberId),
          eq(suggestions.state, 'pending'),
          inArray(suggestions.kind, kinds),
          fingerprints.length > 0 ? notInArray(suggestions.fingerprint, fingerprints) : undefined,
        ),
      );
  }
  return { created };
}

export async function listPendingSuggestions(
  db: Db,
  installationId: number,
  memberId: string,
): Promise<SuggestionRow[]> {
  return db
    .select(columns)
    .from(suggestions)
    .where(
      and(
        eq(suggestions.installationId, installationId),
        eq(suggestions.memberId, memberId),
        eq(suggestions.state, 'pending'),
      ),
    )
    .orderBy(asc(suggestions.createdAt), asc(suggestions.id));
}

export type DecideSuggestionResult = 'applied' | 'unchanged' | 'conflict' | 'not_found';

export async function decideSuggestion(
  db: Db,
  installationId: number,
  memberId: string,
  id: string,
  decision: 'confirmed' | 'ignored',
): Promise<DecideSuggestionResult> {
  const scope = and(
    eq(suggestions.id, id),
    eq(suggestions.installationId, installationId),
    eq(suggestions.memberId, memberId),
  );
  const rows = await db
    .update(suggestions)
    .set({ state: decision, decidedAt: sql`now()` })
    .where(and(scope, eq(suggestions.state, 'pending')))
    .returning({ id: suggestions.id });
  if (rows.length > 0) return 'applied';
  const [row] = await db.select({ state: suggestions.state }).from(suggestions).where(scope);
  if (!row) return 'not_found';
  return row.state === decision ? 'unchanged' : 'conflict';
}

export async function confirmSuggestionsByUrl(
  db: Db,
  installationId: number,
  memberId: string,
  urls: string[],
): Promise<number> {
  if (urls.length === 0) return 0;
  const rows = await db
    .update(suggestions)
    .set({ state: 'confirmed', decidedAt: sql`now()` })
    .where(
      and(
        eq(suggestions.installationId, installationId),
        eq(suggestions.memberId, memberId),
        eq(suggestions.state, 'pending'),
        inArray(sql`${suggestions.ref}->>'url'`, urls),
      ),
    )
    .returning({ id: suggestions.id });
  return rows.length;
}

export async function markSuggestionNotified(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(suggestions)
    .set({ notifiedAt: sql`now()` })
    .where(and(eq(suggestions.id, id), isNull(suggestions.notifiedAt)))
    .returning({ id: suggestions.id });
  return rows.length > 0;
}

export async function deleteDecidedSuggestionsBefore(db: Db, cutoff: Date): Promise<number> {
  const rows = await db
    .delete(suggestions)
    .where(
      and(
        inArray(suggestions.state, ['confirmed', 'ignored', 'resolved']),
        sql`coalesce(${suggestions.decidedAt}, ${suggestions.createdAt}) < ${cutoff.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: suggestions.id });
  return rows.length;
}
