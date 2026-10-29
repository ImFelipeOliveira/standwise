import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { rateLimits } from '../schema';

export type RateLimitHit = { count: number; windowStart: Date };

export async function hitRateLimit(
  db: Db,
  key: string,
  now: Date,
  windowSeconds: number,
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
  return { count: row?.count ?? 1, windowStart };
}
