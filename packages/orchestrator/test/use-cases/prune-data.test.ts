import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  insertWebhookDeliveries,
  insertWebhookEndpoint,
  listRecentWebhookDeliveries,
} from '@standwise/db';
import {
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
});
