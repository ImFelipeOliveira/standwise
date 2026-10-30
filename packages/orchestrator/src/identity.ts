import { memberOverrides } from '@standwise/core';
import { getInstallation, getMemberById, operationalConfig, setIdentity } from '@standwise/db';
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
      const chat = await deps.chatFor(installationId, 'slack');
      if (!chat) continue;
      const externalId =
        memberOverrides(config, login).slack ?? (email ? await chat.findUserByEmail(email) : null);
      if (externalId) await setIdentity(deps.db, installationId, memberId, 'slack', externalId);
    } catch (error) {
      logError('chat identity link failed', error);
    }
  }
}
