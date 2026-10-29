import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { hitRateLimit, peekRateLimit, pruneRateLimits } from '../src';
import { db, useCleanDb } from './setup';

useCleanDb();

const now = new Date('2026-10-28T15:00:05Z');

async function keys(): Promise<string[]> {
  const rows = await db.execute(sql`SELECT key FROM rate_limits ORDER BY key`);
  return rows.map((r) => (r as { key: string }).key);
}

async function seedOld() {
  await hitRateLimit(db, 'old', new Date('2026-10-28T14:40:00Z'), 60, () => false);
  await hitRateLimit(db, 'recent', new Date('2026-10-28T14:55:00Z'), 60, () => false);
}

describe('rate limits repo', () => {
  test('counts hits inside one window', async () => {
    const first = await hitRateLimit(db, 'k', now, 60, () => false);
    const second = await hitRateLimit(db, 'k', now, 60, () => false);
    expect([first.count, second.count]).toEqual([1, 2]);
  });

  test('peekRateLimit reads without counting', async () => {
    expect((await peekRateLimit(db, 'k', now, 60)).count).toBe(0);
    await hitRateLimit(db, 'k', now, 60, () => false);
    expect((await peekRateLimit(db, 'k', now, 60)).count).toBe(1);
    expect((await peekRateLimit(db, 'k', now, 60)).count).toBe(1);
    expect((await peekRateLimit(db, 'k', new Date('2026-10-28T15:01:00Z'), 60)).count).toBe(0);
  });

  test('pruneRateLimits removes windows older than 10 minutes', async () => {
    await seedOld();
    await hitRateLimit(db, 'current', now, 60, () => false);
    await pruneRateLimits(db, now);
    expect(await keys()).toEqual(['current', 'recent']);
  });

  test('hitRateLimit prunes opportunistically when the hook says so', async () => {
    await seedOld();
    await hitRateLimit(db, 'current', now, 60, () => false);
    expect(await keys()).toEqual(['current', 'old', 'recent']);
    await hitRateLimit(db, 'current', now, 60, () => true);
    expect(await keys()).toEqual(['current', 'recent']);
  });

  test('window_start is indexed', async () => {
    const rows = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE tablename = 'rate_limits'`,
    );
    expect(rows.map((r) => (r as { indexname: string }).indexname)).toContain(
      'rate_limits_window_start_idx',
    );
  });
});
