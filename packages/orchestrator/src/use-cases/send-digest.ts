import { buildDigest, type DigestEntry, type Person } from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  type DeliveryKey,
  failDelivery,
  getIdentities,
  getInstallation,
  listDailies,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { resolveTeams } from '../teams';
import { describeDeliveryError } from './delivery-error';

export type SendDigestJob = { installationId: number; teamName: string; date: string };

export async function sendDigest(deps: WorkerDeps, job: SendDigestJob): Promise<void> {
  const installation = await getInstallation(deps.db, job.installationId);
  if (installation?.status !== 'configured' || !installation.config) return;
  const teamConfig = installation.config.teams.find((t) => t.name === job.teamName);
  if (!teamConfig) return;

  const key: DeliveryKey = { ...job, kind: 'digest' };
  const claim = await claimDelivery(deps.db, key);
  if (claim.status !== 'claimed') return;

  if (teamConfig.chat.provider !== 'slack') {
    await failDelivery(deps.db, key, claim.token, 'unsupported_provider');
    return;
  }

  try {
    const chat = await deps.chatFor(job.installationId, 'slack');
    if (!chat) {
      await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
      return;
    }
    const [team] = await resolveTeams(deps, installation.id, installation.accountLogin, {
      ...installation.config,
      teams: [teamConfig],
    });
    if (!team) throw new Error('team not resolved');
    const dailies = await listDailies(deps.db, job.installationId, job.date);
    const identities = await getIdentities(deps.db, job.installationId, 'slack');
    const person = (login: string): Person => {
      const chatUserId = identities.get(login.toLowerCase());
      return chatUserId ? { login, chatUserId } : { login };
    };
    const entries: DigestEntry[] = [];
    const missing: Person[] = [];
    for (const login of team.memberLogins) {
      const found = dailies.find((d) => d.login.toLowerCase() === login);
      if (found) entries.push({ ...person(found.login), daily: found.payload });
      else missing.push(person(login));
    }
    const ref = await chat.postToChannel(
      team.chat.channel,
      buildDigest({ team, date: job.date, entries, missing }),
    );
    await completeDelivery(deps.db, key, claim.token, ref);
  } catch (error) {
    await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
    throw error;
  }
}
