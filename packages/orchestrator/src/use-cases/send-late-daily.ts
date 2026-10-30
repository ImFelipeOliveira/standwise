import { buildLateDaily, type MessageRef, memberOverrides, teamsForMember } from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  type DeliveryKey,
  failDelivery,
  getDelivery,
  getIdentities,
  getInstallation,
  getMemberById,
  listDailies,
  operationalConfig,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { resolveTeams } from '../teams';
import { describeDeliveryError } from './delivery-error';

export type SendLateDailyJob = { installationId: number; memberId: string; date: string };

export async function sendLateDaily(deps: WorkerDeps, job: SendLateDailyJob): Promise<void> {
  const installation = await getInstallation(deps.db, job.installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;
  const member = await getMemberById(deps.db, job.memberId);
  if (!member) return;
  const found = (await listDailies(deps.db, job.installationId, job.date)).find(
    (d) => d.memberId === job.memberId,
  );
  if (!found) return;
  const chat = await deps.chatFor(job.installationId, 'slack');

  const teams = await resolveTeams(deps, installation.id, installation.accountLogin, config);
  const chatUserId =
    memberOverrides(config, member.login).slack ??
    (await getIdentities(deps.db, job.installationId, 'slack')).get(member.login.toLowerCase());
  const entry = {
    login: member.login,
    ...(chatUserId ? { chatUserId } : {}),
    daily: found.payload,
  };

  for (const team of teamsForMember(member.login, teams)) {
    if (team.chat.provider !== 'slack') continue;
    const digest = await getDelivery(deps.db, {
      installationId: job.installationId,
      teamName: team.name,
      date: job.date,
      kind: 'digest',
    });
    if (digest?.status !== 'sent' || !digest.ref) continue;
    const key: DeliveryKey = {
      installationId: job.installationId,
      teamName: team.name,
      date: job.date,
      kind: 'late_daily',
      subject: job.memberId,
    };
    const claim = await claimDelivery(deps.db, key);
    if (claim.status !== 'claimed') continue;
    if (!chat) {
      await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
      continue;
    }
    let ref: MessageRef;
    try {
      ref = await chat.replyInThread(digest.ref, buildLateDaily(entry, team.language));
    } catch (error) {
      await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
      throw error;
    }
    await completeDelivery(deps.db, key, claim.token, ref);
  }
}
