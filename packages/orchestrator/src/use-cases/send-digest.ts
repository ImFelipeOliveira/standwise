import {
  buildDigest,
  type DigestEntry,
  type MessageRef,
  type Person,
  type ResolvedTeam,
} from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  type DeliveryKey,
  failDelivery,
  getIdentities,
  getInstallation,
  getMemberLogins,
  listDailies,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { resolveTeams } from '../teams';
import { describeDeliveryError } from './delivery-error';

export type SendDigestJob = { installationId: number; teamName: string; date: string };

type Daily = Awaited<ReturnType<typeof listDailies>>[number];

function teamDailies(team: ResolvedTeam, dailies: Daily[]): Daily[] {
  return dailies.filter((d) => team.memberLogins.includes(d.login.toLowerCase()));
}

async function enqueueLateDailies(
  deps: WorkerDeps,
  job: SendDigestJob,
  team: ResolvedTeam,
  snapshot: Daily[],
): Promise<void> {
  const current = teamDailies(team, await listDailies(deps.db, job.installationId, job.date));
  for (const daily of current) {
    const before = snapshot.find((d) => d.memberId === daily.memberId);
    if (before && daily.submittedAt.getTime() <= before.submittedAt.getTime()) continue;
    await deps.queue.enqueue('send-late-daily', {
      installationId: job.installationId,
      memberId: daily.memberId,
      date: job.date,
    });
  }
}

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

  let team: ResolvedTeam;
  let snapshot: Daily[];
  let ref: MessageRef;
  try {
    const chat = await deps.chatFor(job.installationId, 'slack');
    if (!chat) {
      await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
      return;
    }
    const [resolved] = await resolveTeams(deps, installation.id, installation.accountLogin, {
      ...installation.config,
      teams: [teamConfig],
    });
    if (!resolved) throw new Error('team not resolved');
    team = resolved;
    snapshot = teamDailies(team, await listDailies(deps.db, job.installationId, job.date));
    const identities = await getIdentities(deps.db, job.installationId, 'slack');
    const stored = await getMemberLogins(deps.db, team.memberLogins);
    const written = new Map(teamConfig.members.map((m) => [m.toLowerCase(), m]));
    const person = (login: string): Person => {
      const lower = login.toLowerCase();
      const display = stored.get(lower) ?? written.get(lower) ?? login;
      const chatUserId = identities.get(lower);
      return chatUserId ? { login: display, chatUserId } : { login: display };
    };
    const entries: DigestEntry[] = [];
    const missing: Person[] = [];
    for (const login of team.memberLogins) {
      const found = snapshot.find((d) => d.login.toLowerCase() === login);
      if (found) entries.push({ ...person(found.login), daily: found.payload });
      else missing.push(person(login));
    }
    ref = await chat.postToChannel(
      team.chat.channel,
      buildDigest({ team, date: job.date, entries, missing }),
    );
  } catch (error) {
    await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
    throw error;
  }

  if (await completeDelivery(deps.db, key, claim.token, ref)) {
    await enqueueLateDailies(deps, job, team, snapshot);
  }
}
