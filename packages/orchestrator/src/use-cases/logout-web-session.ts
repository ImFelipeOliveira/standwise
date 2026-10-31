import { revokeSession } from '@standwise/db';
import type { Deps } from '../deps';

export async function logoutWebSession(deps: Deps, token: string): Promise<void> {
  await revokeSession(deps.db, token);
}
