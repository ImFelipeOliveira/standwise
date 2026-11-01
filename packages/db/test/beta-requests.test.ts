import { describe, expect, test } from 'bun:test';
import {
  type BetaRequestInput,
  deleteBetaRequestsCreatedBefore,
  getBetaRequest,
  markBetaRequestNotified,
  upsertBetaRequest,
} from '../src';
import { db, useCleanDb } from './setup';

useCleanDb();

const now = new Date('2026-11-01T12:00:00Z');
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

const input: BetaRequestInput = {
  name: 'Ana',
  email: 'ana@example.com',
  teamSize: '3-5',
  chat: 'slack',
  tracker: 'linear',
  locale: 'pt-BR',
};

describe('beta requests repo', () => {
  test('inserts a new request', async () => {
    const created = await upsertBetaRequest(db, input, now);
    expect(created).not.toBeNull();
    const row = await getBetaRequest(db, (created as { id: string }).id);
    expect(row).toMatchObject({ ...input, createdAt: now, notifiedAt: null });
  });

  test('returns null for an unknown id', async () => {
    expect(await getBetaRequest(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('duplicate within 24h returns null', async () => {
    await upsertBetaRequest(db, input, now);
    expect(await upsertBetaRequest(db, input, hours(23))).toBeNull();
  });

  test('re-request after 24h returns the same id and resets notifiedAt', async () => {
    const first = await upsertBetaRequest(db, input, now);
    const id = (first as { id: string }).id;
    await markBetaRequestNotified(db, id, hours(1));
    const again = await upsertBetaRequest(db, { ...input, name: 'Ana B' }, hours(25));
    expect(again).toEqual({ id });
    const row = await getBetaRequest(db, id);
    expect(row?.notifiedAt).toBeNull();
    expect(row?.name).toBe('Ana B');
    expect(row?.createdAt).toEqual(hours(25));
  });

  test('normalizes email', async () => {
    const first = await upsertBetaRequest(db, { ...input, email: ' Ana@Example.COM ' }, now);
    expect(first).not.toBeNull();
    expect(await upsertBetaRequest(db, { ...input, email: 'ana@example.com' }, now)).toBeNull();
    const row = await getBetaRequest(db, (first as { id: string }).id);
    expect(row?.email).toBe('ana@example.com');
  });

  test('markBetaRequestNotified returns true once, then false', async () => {
    const created = await upsertBetaRequest(db, input, now);
    const id = (created as { id: string }).id;
    expect(await markBetaRequestNotified(db, id, hours(1))).toBe(true);
    expect(await markBetaRequestNotified(db, id, hours(2))).toBe(false);
    expect((await getBetaRequest(db, id))?.notifiedAt).toEqual(hours(1));
  });

  test('deleteBetaRequestsCreatedBefore deletes only older rows', async () => {
    const old = await upsertBetaRequest(db, { ...input, email: 'old@example.com' }, hours(-48));
    const fresh = await upsertBetaRequest(db, { ...input, email: 'new@example.com' }, now);
    expect(await deleteBetaRequestsCreatedBefore(db, hours(-24))).toBe(1);
    expect(await getBetaRequest(db, (old as { id: string }).id)).toBeNull();
    expect(await getBetaRequest(db, (fresh as { id: string }).id)).not.toBeNull();
  });
});
