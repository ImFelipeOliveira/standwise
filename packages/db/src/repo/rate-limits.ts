import { lt, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { rateLimits } from '../schema';

export type RateLimitHit = { count: number; windowStart: Date };

const RETENTION_MS = 10 * 60 * 1000;
const PRUNE_PROBABILITY = 0.01;

export async function pruneRateLimits(db: Db, now: Date = new Date()): Promise<void> {
  await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - RETENTION_MS)));
}

export async function hitRateLimit(
  db: Db,
  key: string,
  now: Date,
  windowSeconds: number,
  shouldPrune: () => boolean = () => Math.random() < PRUNE_PROBABILITY,
): Promise<RateLimitHit> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  if (shouldPrune()) await pruneRateLimits(db, now);
  return { count: row?.count ?? 1, windowStart };
}
