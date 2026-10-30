import { describe, expect, test } from 'bun:test';
import type { Signal } from '@standwise/core';
import {
  claimDelivery,
  confirmSuggestionsByUrl,
  decideSuggestion,
  listPendingSuggestions,
  markSuggestionNotified,
  syncSuggestions,
  upsertInstallation,
  upsertMember,
} from '../src';
import { db, useCleanDb } from './setup';

useCleanDb();

const INST = 100;
const sig = (n: number, kind: Signal['kind'] = 'pr_no_review', suffix = ''): Signal => ({
  kind,
  ref: { kind: 'pull_request', url: `https://github.com/acme/api/pull/${n}`, title: `PR ${n}` },
  fingerprint: `${kind}:${n}${suffix}`,
  since: new Date('2026-10-27T10:00:00Z'),
});

async function seed() {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  await upsertInstallation(db, { id: 200, accountLogin: 'other', accountType: 'Organization' });
  const ana = await upsertMember(db, { githubUserId: 1, login: 'Ana', email: null });
  const bob = await upsertMember(db, { githubUserId: 2, login: 'Bob', email: null });
  return { ana, bob };
}

const K = ['pr_no_review', 'ci_failing'] as const;

describe('suggestions', () => {
  test('creates new fingerprints and returns only created rows', async () => {
    const { ana } = await seed();
    const first = await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.state).toBe('pending');
    const second = await syncSuggestions(db, INST, ana.id, [...K], [sig(1), sig(2)]);
    expect(second.created.map((r) => r.fingerprint)).toEqual(['pr_no_review:2']);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(2);
  });

  test('concurrent syncs create each row once', async () => {
    const { ana } = await seed();
    const r = await Promise.all([
      syncSuggestions(db, INST, ana.id, [...K], [sig(1)]),
      syncSuggestions(db, INST, ana.id, [...K], [sig(1)]),
    ]);
    expect(r.flatMap((x) => x.created)).toHaveLength(1);
  });

  test('ignored suggestion stays ignored on same fingerprint', async () => {
    const { ana } = await seed();
    const { created } = await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    expect(await decideSuggestion(db, INST, ana.id, created[0]?.id ?? '', 'ignored')).toBe(true);
    const again = await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    expect(again.created).toHaveLength(0);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(0);
  });

  test('resolved suggestion is not revived', async () => {
    const { ana } = await seed();
    await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    await syncSuggestions(db, INST, ana.id, [...K], []);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(0);
    const again = await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    expect(again.created).toHaveLength(0);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(0);
  });

  test('resolves pending rows whose signal disappeared, only for given kinds', async () => {
    const { ana } = await seed();
    await syncSuggestions(
      db,
      INST,
      ana.id,
      ['pr_no_review', 'card_stale'],
      [sig(1), sig(2, 'card_stale')],
    );
    await syncSuggestions(db, INST, ana.id, ['pr_no_review'], []);
    const pending = await listPendingSuggestions(db, INST, ana.id);
    expect(pending.map((r) => r.kind)).toEqual(['card_stale']);
  });

  test('new fingerprint for same ref creates a new row', async () => {
    const { ana } = await seed();
    await syncSuggestions(db, INST, ana.id, [...K], [sig(1, 'ci_failing', ':a')]);
    const next = await syncSuggestions(db, INST, ana.id, [...K], [sig(1, 'ci_failing', ':b')]);
    expect(next.created).toHaveLength(1);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(1);
  });

  test('decideSuggestion on another member or installation returns false', async () => {
    const { ana, bob } = await seed();
    const { created } = await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    const id = created[0]?.id ?? '';
    expect(await decideSuggestion(db, INST, bob.id, id, 'confirmed')).toBe(false);
    expect(await decideSuggestion(db, 200, ana.id, id, 'confirmed')).toBe(false);
    expect(await decideSuggestion(db, INST, ana.id, id, 'confirmed')).toBe(true);
    expect(await decideSuggestion(db, INST, ana.id, id, 'ignored')).toBe(false);
  });

  test('confirmSuggestionsByUrl confirms only that member pending rows with the url', async () => {
    const { ana, bob } = await seed();
    await syncSuggestions(db, INST, ana.id, [...K], [sig(1), sig(2)]);
    await syncSuggestions(db, INST, bob.id, [...K], [sig(1)]);
    const n = await confirmSuggestionsByUrl(db, INST, ana.id, [
      'https://github.com/acme/api/pull/1',
    ]);
    expect(n).toBe(1);
    expect(await confirmSuggestionsByUrl(db, INST, ana.id, [])).toBe(0);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(1);
    expect(await listPendingSuggestions(db, INST, bob.id)).toHaveLength(1);
    expect(
      await confirmSuggestionsByUrl(db, 200, bob.id, ['https://github.com/acme/api/pull/1']),
    ).toBe(0);
  });

  test('tenant isolation on list and sync resolve', async () => {
    const { ana } = await seed();
    await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    expect(await listPendingSuggestions(db, 200, ana.id)).toHaveLength(0);
    await syncSuggestions(db, 200, ana.id, [...K], []);
    expect(await listPendingSuggestions(db, INST, ana.id)).toHaveLength(1);
  });

  test('markSuggestionNotified', async () => {
    const { ana } = await seed();
    const { created } = await syncSuggestions(db, INST, ana.id, [...K], [sig(1)]);
    expect(await markSuggestionNotified(db, created[0]?.id ?? '')).toBe(true);
    expect(await markSuggestionNotified(db, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});

describe('person-level deliveries', () => {
  test('reminder with empty team is exclusive per login and day', async () => {
    await seed();
    const k = {
      installationId: INST,
      teamName: '',
      date: '2026-10-27',
      kind: 'reminder',
      subject: 'ana',
    } as const;
    const r = await Promise.all([claimDelivery(db, k), claimDelivery(db, k)]);
    expect(r.filter((x) => x.status === 'claimed')).toHaveLength(1);
    const other = await claimDelivery(db, { ...k, subject: 'bob' });
    expect(other.status).toBe('claimed');
    const nextDay = await claimDelivery(db, { ...k, date: '2026-10-28' });
    expect(nextDay.status).toBe('claimed');
  });
});
