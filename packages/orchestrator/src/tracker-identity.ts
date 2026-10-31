import { memberOverrides, type StandwiseConfig } from '@standwise/core';
import {
  deleteIdentity,
  findMemberByIdentity,
  getInstallation,
  getMemberById,
  listInstallationMembers,
  operationalConfig,
  setIdentity,
} from '@standwise/db';
import { findUserByEmail, LinearAuthError, LinearRateLimitError } from '@standwise/linear';
import type { Deps, WorkerDeps } from './deps';
import { type LinearAccess, linearClientFor } from './linear-access';
import { logError } from './log-error';

export const LINK_TRACKER_IDENTITIES_JOB = 'link-tracker-identities';
export const LINK_TRACKER_BATCH = 200;

export type LinkTrackerIdentitiesJob = { installationId: number };

type LinkDeps = Pick<WorkerDeps, 'db' | 'encryptionKey' | 'linear' | 'now' | 'env'>;

class LinkStopped extends Error {}

function configLogins(config: StandwiseConfig): Set<string> {
  const logins = new Set<string>();
  for (const team of config.teams) {
    for (const login of [...team.members, ...team.managers]) logins.add(login.toLowerCase());
  }
  return logins;
}

async function linkOne(
  deps: LinkDeps,
  access: LinearAccess,
  installationId: number,
  config: StandwiseConfig,
  member: { id: string; login: string },
  githubEmail: string | null,
): Promise<void> {
  const email = memberOverrides(config, member.login).linear ?? githubEmail;
  if (!email) return;
  try {
    const user = await findUserByEmail(access.client, email);
    if (user) await setIdentity(deps.db, installationId, member.id, 'linear', user.id);
    else await deleteIdentity(deps.db, installationId, member.id, 'linear');
  } catch (error) {
    if (error instanceof LinearAuthError) {
      await access.invalidate();
      throw new LinkStopped('auth', { cause: error });
    }
    if (error instanceof LinearRateLimitError) {
      throw new LinkStopped('rate_limited', { cause: error });
    }
    throw error;
  }
}

export async function linkTrackerIdentity(
  deps: Deps,
  installationId: number,
  memberId: string,
  githubEmail: string | null,
): Promise<void> {
  try {
    const member = await getMemberById(deps.db, memberId);
    if (!member) return;
    const config = operationalConfig(await getInstallation(deps.db, installationId));
    if (!config) return;
    const access = await linearClientFor(deps, installationId);
    if (!access) return;
    await linkOne(deps, access, installationId, config, member, githubEmail);
  } catch (error) {
    logError(
      'tracker identity link failed',
      error instanceof LinkStopped ? (error.cause ?? error) : error,
      { installationId: String(installationId) },
    );
  }
}

export async function linkTrackerIdentities(
  deps: WorkerDeps,
  installationId: number,
): Promise<void> {
  const config = operationalConfig(await getInstallation(deps.db, installationId));
  if (!config) return;
  const access = await linearClientFor(deps, installationId);
  if (!access) return;
  const logins = configLogins(config);
  const candidates = (await listInstallationMembers(deps.db, installationId))
    .filter((m) => logins.has(m.login.toLowerCase()))
    .slice(0, LINK_TRACKER_BATCH);
  for (const member of candidates) {
    try {
      await linkOne(deps, access, installationId, config, member, member.email);
    } catch (error) {
      if (error instanceof LinkStopped) {
        logError('tracker identity linking stopped', error.cause ?? error, {
          installationId: String(installationId),
        });
        return;
      }
      logError('tracker identity link failed', error, { installationId: String(installationId) });
    }
  }
}

export async function loginForLinearUser(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  config: StandwiseConfig,
  user: { id: string; email: string | null },
): Promise<string | null> {
  const logins = configLogins(config);
  const email = user.email?.toLowerCase();
  if (email) {
    const matches = Object.entries(config.members)
      .filter(([login, o]) => o.linear?.toLowerCase() === email && logins.has(login.toLowerCase()))
      .map(([login]) => login);
    if (matches.length > 1) {
      logError('linear user matches several config overrides', new Error('ambiguous_override'), {
        installationId: String(installationId),
      });
      return null;
    }
    if (matches[0]) return matches[0];
  }
  const member = await findMemberByIdentity(deps.db, installationId, 'linear', user.id);
  if (!member || !logins.has(member.login.toLowerCase())) return null;
  return member.login;
}
