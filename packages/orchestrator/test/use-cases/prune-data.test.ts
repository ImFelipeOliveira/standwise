import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  getDelivery,
  insertWebhookDeliveries,
  insertWebhookEndpoint,
  listRecentWebhookDeliveries,
  markDeliverySent,
} from '@standwise/db';
import {
  ageDeliveries,
  insertAgedSessions,
  insertAgedSuggestion,
  listSessionTokens,
  listSuggestionFingerprints,
} from '../../../db/test/aged-rows';
import { db, useCleanDb } from '../../../db/test/setup';
import { pruneData } from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const NOW = new Date('2026-10-28T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const KEY = new Uint8Array(32).fill(7);

async function seedDeliveries() {
  const { id: endpointId } = await insertWebhookEndpoint(
    db,
    {
      installationId: INST,
      url: 'https://hooks.example.com/x',
      events: ['daily.submitted'],
      secret: 's',
    },
    KEY,
  );
  const make = (eventId: string, createdAt: Date) => ({
    endpointId,
    event: 'daily.submitted' as const,
    eventId,
    payload: {},
    nextAttemptAt: createdAt,
    createdAt,
  });
  await insertWebhookDeliveries(db, [
    make(randomUUID(), daysAgo(31)),
    make(randomUUID(), daysAgo(29)),
  ]);
}

async function suggestion(
  memberId: string,
  fingerprint: string,
  state: 'pending' | 'confirmed' | 'ignored' | 'resolved',
  createdAt: Date,
  decidedAt: Date | null,
) {
  await insertAgedSuggestion({
    installationId: INST,
    memberId,
    fingerprint,
    state,
    createdAt,
    decidedAt,
  });
}

describe('pruneData', () => {
  test('deletes webhook deliveries older than 30 days only', async () => {
    await seedOrg();
    await seedDeliveries();
    const { deps } = fakeDeps();
    deps.now = () => NOW;
    const result = await pruneData(deps);
    expect(result.webhookDeliveries).toBe(1);
    const left = await listRecentWebhookDeliveries(db, INST, 10);
    expect(left.map((r) => r.createdAt)).toEqual([daysAgo(29)]);
  });

  test('deletes expired web and cli sessions and keeps live ones', async () => {
    await seedOrg();
    const member = await seedMember();
    await insertAgedSessions([
      {
        tokenHash: 'web-old',
        memberId: member.id,
        kind: 'web',
        createdAt: daysAgo(8),
        lastUsedAt: NOW,
      },
      {
        tokenHash: 'web-new',
        memberId: member.id,
        kind: 'web',
        createdAt: daysAgo(6),
        lastUsedAt: NOW,
      },
      {
        tokenHash: 'cli-idle',
        memberId: member.id,
        kind: 'cli',
        createdAt: daysAgo(200),
        lastUsedAt: daysAgo(91),
      },
      {
        tokenHash: 'cli-live',
        memberId: member.id,
        kind: 'cli',
        createdAt: daysAgo(200),
        lastUsedAt: daysAgo(89),
      },
    ]);
    const { deps } = fakeDeps();
    deps.now = () => NOW;
    expect((await pruneData(deps)).sessions).toBe(2);
    const left = await listSessionTokens();
    expect(left).toEqual(['cli-live', 'web-new']);
  });

  test('deletes only resolved suggestions older than 90 days and keeps ignored and confirmed ones', async () => {
    await seedOrg();
    const member = await seedMember();
    await suggestion(member.id, 'a', 'confirmed', daysAgo(200), daysAgo(91));
    await suggestion(member.id, 'b', 'ignored', daysAgo(200), daysAgo(91));
    await suggestion(member.id, 'c', 'resolved', daysAgo(91), null);
    await suggestion(member.id, 'd', 'confirmed', daysAgo(200), daysAgo(10));
    await suggestion(member.id, 'e', 'resolved', daysAgo(10), null);
    await suggestion(member.id, 'g', 'resolved', daysAgo(200), daysAgo(91));
    await suggestion(member.id, 'f', 'pending', daysAgo(200), null);
    const { deps } = fakeDeps();
    deps.now = () => NOW;
    expect((await pruneData(deps)).suggestions).toBe(2);
    const left = await listSuggestionFingerprints();
    expect(left).toEqual(['a', 'b', 'd', 'e', 'f']);
  });

  test('deletes person-level delivery rows older than 90 days and keeps team rows', async () => {
    await seedOrg();
    const { deps } = fakeDeps();
    deps.now = () => NOW;
    const base = { installationId: INST, teamName: '', date: '2026-07-01' };
    const kinds = ['reminder', 'blocker_route', 'suggestion_dm', 'signal_scan'] as const;
    for (const kind of kinds) {
      await markDeliverySent(db, { ...base, kind, subject: 'old' });
      await markDeliverySent(db, { ...base, kind, subject: 'recent' });
    }
    await markDeliverySent(db, { ...base, teamName: 'Alpha', kind: 'digest' });
    await ageDeliveries(['old', ''], daysAgo(91));
    await ageDeliveries(['recent'], daysAgo(89));
    expect((await pruneData(deps)).personDeliveries).toBe(4);
    for (const kind of kinds) {
      expect(await getDelivery(db, { ...base, kind, subject: 'old' })).toBeNull();
      expect(await getDelivery(db, { ...base, kind, subject: 'recent' })).not.toBeNull();
    }
    expect(await getDelivery(db, { ...base, teamName: 'Alpha', kind: 'digest' })).not.toBeNull();
  });
});
