import { buildReminder, isWorkday, localInstant, teamsForMember } from '@standwise/core';
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
import { chatUserIdFor, forgetStaleChatIdentity } from '../chat-identity';
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

  const now = deps.now().getTime();
  const eligible: { team: (typeof teams)[number]; at: number }[] = [];
  for (const team of teams) {
    if (!isWorkday(job.date, team)) continue;
    const at = localInstant(job.date, team.digestAt, team.timezone).getTime();
    if (now >= at) continue;
    const digest = await getDelivery(deps.db, {
      installationId: job.installationId,
      teamName: team.name,
      date: job.date,
      kind: 'digest',
    });
    if (digest?.status === 'sent') continue;
    eligible.push({ team, at });
  }
  const earliest = eligible.sort((x, y) => x.at - y.at)[0];
  if (!earliest) return;

  const key: DeliveryKey = {
    installationId: job.installationId,
    teamName: '',
    date: job.date,
    kind: 'reminder',
    subject: login,
  };
  const claim = await claimDelivery(deps.db, key);
  if (claim.status !== 'claimed') return;

  let chatUserId: string | null = null;
  try {
    const chat = await deps.chatFor(job.installationId, 'slack');
    if (!chat) {
      await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
      return;
    }
    chatUserId = await chatUserIdFor(deps, job.installationId, config, login);
    if (!chatUserId) {
      await failDelivery(deps.db, key, claim.token, `no_chat_identity: ${login}`);
      return;
    }
    const ref = await chat.sendDirect(
      chatUserId,
      buildReminder({ team: first, date: job.date, digestAt: earliest.team.digestAt }),
    );
    await completeDelivery(deps.db, key, claim.token, ref);
  } catch (error) {
    await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
    if (chatUserId) {
      await forgetStaleChatIdentity(deps, job.installationId, config, login, chatUserId, error);
    }
    throw error;
  }
}
