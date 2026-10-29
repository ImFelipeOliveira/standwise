import { getConnection } from '@standwise/db';
import { createSlackChannel } from '@standwise/slack';
import type { Deps } from './deps';

export function createChatFor(
  db: Parameters<typeof getConnection>[0],
  encryptionKey: Uint8Array,
): Deps['chatFor'] {
  return async (installationId, provider) => {
    const connection = await getConnection(db, installationId, provider, encryptionKey);
    return connection ? createSlackChannel(connection.secret) : null;
  };
}
