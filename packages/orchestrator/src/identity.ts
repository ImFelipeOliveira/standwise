import { memberOverrides } from '@standcast/core';
import {
  getConnectionExternalId,
  getInstallation,
  getMemberById,
  operationalConfig,
  writeIdentityIfConnected,
} from '@standcast/db';
import type { Deps } from './deps';
import { logError } from './log-error';

export async function linkChatIdentities(
  deps: Deps,
  memberId: string,
  email: string | null,
  installationIds: number[],
): Promise<void> {
  const member = await getMemberById(deps.db, memberId);
  if (!member) return;
  const login = member.login.toLowerCase();
  for (const installationId of installationIds) {
    try {
      const installation = await getInstallation(deps.db, installationId);
      const config = operationalConfig(installation);
      if (!config) continue;
      const teamId = await getConnectionExternalId(deps.db, installationId, 'slack');
      if (!teamId) continue;
      const chat = await deps.chatFor(installationId, 'slack');
      if (!chat) continue;
      const externalId =
        memberOverrides(config, login).slack ?? (email ? await chat.findUserByEmail(email) : null);
      if (!externalId) continue;
      await writeIdentityIfConnected(deps.db, {
        installationId,
        memberId,
        provider: 'slack',
        connectionExternalId: teamId,
        externalId,
      });
    } catch (error) {
      logError('chat identity link failed', error);
    }
  }
}
