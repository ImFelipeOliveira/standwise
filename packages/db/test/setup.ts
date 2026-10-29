import { beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createDb, type Db, migrate } from '../src';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://standwise:standwise@localhost:5433/standwise_test';

await migrate(TEST_DATABASE_URL);

export const db: Db = createDb(TEST_DATABASE_URL);

export function useCleanDb(): void {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE installations, members, member_installations, member_identities,
        connections, sessions, dailies, deliveries, rate_limits, api_keys CASCADE
    `);
  });
}
