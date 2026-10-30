import { buildReminder, teamsForMember } from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  type DeliveryKey,
  failDelivery,
  getDelivery,
  getInstallation,
  listDailies,
  operationalConfig,
} from '@standwise/db';
import { chatUserIdFor } from '../chat-identity';
import type { WorkerDeps } from '../deps';
import { resolveTeams } from '../teams';
import { describeDeliveryError } from './delivery-error';

export type SendReminderJob = { installationId: number; login: string; date: string };

export async function sendReminder(deps: WorkerDeps, job: SendReminderJob): Promise<void> {
  const login = job.login.toLowerCase();
  const installation = await getInstallation(deps.db, job.installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;

  const teams = teamsForMember(
    login,
    await resolveTeams(deps, installation.id, installation.accountLogin, config),
  );
  const first = teams[0];
  if (!first) return;

  const dailies = await listDailies(deps.db, job.installationId, job.date);
  if (dailies.some((d) => d.login.toLowerCase() === login)) return;

  let pendingDigest = false;
  for (const team of teams) {
    const digest = await getDelivery(deps.db, {
      installationId: job.installationId,
      teamName: team.name,
      date: job.date,
      kind: 'digest',
    });
    if (digest?.status !== 'sent') pendingDigest = true;
  }
  if (!pendingDigest) return;

  const key: DeliveryKey = {
    installationId: job.installationId,
    teamName: '',
    date: job.date,
    kind: 'reminder',
    subject: login,
  };
  const claim = await claimDelivery(deps.db, key);
  if (claim.status !== 'claimed') return;

  const chat = await deps.chatFor(job.installationId, 'slack');
  if (!chat) {
    await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
    return;
  }
  const chatUserId = await chatUserIdFor(deps, job.installationId, config, login);
  if (!chatUserId) {
    await failDelivery(deps.db, key, claim.token, `no_chat_identity: ${login}`);
    return;
  }
  try {
    const ref = await chat.sendDirect(
      chatUserId,
      buildReminder({ team: first, date: job.date, digestAt: first.digestAt }),
    );
    await completeDelivery(deps.db, key, claim.token, ref);
  } catch (error) {
    await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
    throw error;
  }
}
