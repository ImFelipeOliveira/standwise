import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): Db {
  return drizzle(postgres(url), { schema });
}

const migrationsFolder = new URL('../migrations', import.meta.url).pathname;

/** Applies pending migrations using a short-lived connection. */
export async function migrate(url: string): Promise<void> {
  const client = postgres(url, { max: 1 });
  try {
    await drizzleMigrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
