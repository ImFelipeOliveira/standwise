import { memberOverrides, type StandwiseConfig } from '@standwise/core';
import {
  findMemberByIdentity,
  getConnectionExternalId,
  getInstallation,
  getMemberById,
  listInstallationMembers,
  operationalConfig,
  writeIdentityIfConnected,
} from '@standwise/db';
import { findUserByEmail, LinearAuthError, LinearRateLimitError } from '@standwise/linear';
import type { Deps, WorkerDeps } from './deps';
import { type LinearAccess, linearClientFor } from './linear-access';
import { logError } from './log-error';
import { resolveTeams } from './teams';

export const LINK_TRACKER_IDENTITIES_JOB = 'link-tracker-identities';
export const LINK_TRACKER_BATCH = 200;

export type LinkTrackerIdentitiesJob = { installationId: number };

type LinkDeps = Pick<WorkerDeps, 'db' | 'encryptionKey' | 'linear' | 'now' | 'env'>;

type StopReason = 'auth' | 'rate_limited' | 'workspace_changed';

class LinkStopped extends Error {
  constructor(
    readonly reason: StopReason,
    options?: ErrorOptions,
  ) {
    super(`tracker identity linking stopped: ${reason}`, options);
    this.name = 'LinkStopped';
  }
}

export async function enqueueLinkTrackerIdentities(
  deps: Pick<Deps, 'queue'>,
  installationId: number,
): Promise<void> {
  await deps.queue
    .enqueue(
      LINK_TRACKER_IDENTITIES_JOB,
      { installationId },
      { singletonKey: `link-tracker:${installationId}`, policy: 'stately' },
    )
    .catch((error: unknown) => {
      logError('link tracker identities enqueue failed', error, {
        installationId: String(installationId),
      });
    });
}

export async function configPeople(
  deps: Pick<Deps, 'github' | 'now'>,
  installationId: number,
  owner: string,
  config: StandwiseConfig,
): Promise<Set<string>> {
  const teams = await resolveTeams(deps, installationId, owner, config);
  const people = new Set<string>();
  for (const team of teams) {
    for (const login of [...team.memberLogins, ...team.managers]) people.add(login.toLowerCase());
  }
  return people;
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
  let externalId: string | null = null;
  if (email) {
    try {
      externalId = (await findUserByEmail(access.client, email))?.id ?? null;
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
  const written = await writeIdentityIfConnected(deps.db, {
    installationId,
    memberId: member.id,
    provider: 'linear',
    connectionExternalId: access.organization.id,
    externalId,
  });
  if (!written) throw new LinkStopped('workspace_changed');
}

const causeOf = (error: unknown) => (error instanceof LinkStopped ? (error.cause ?? error) : error);

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
    logError('tracker identity link failed', causeOf(error), {
      installationId: String(installationId),
    });
  }
}

export async function linkTrackerIdentities(
  deps: WorkerDeps,
  installationId: number,
): Promise<void> {
  const installation = await getInstallation(deps.db, installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;
  const access = await linearClientFor(deps, installationId);
  if (!access) return;
  const logins = await configPeople(deps, installationId, installation.accountLogin, config);
  const candidates = (await listInstallationMembers(deps.db, installationId))
    .filter((m) => logins.has(m.login.toLowerCase()))
    .slice(0, LINK_TRACKER_BATCH);
  const extra = { installationId: String(installationId) };
  for (const member of candidates) {
    const current = await getConnectionExternalId(deps.db, installationId, 'linear');
    if (current !== access.organization.id) {
      logError('tracker identity linking stopped', new LinkStopped('workspace_changed'), extra);
      return;
    }
    try {
      await linkOne(deps, access, installationId, config, member, member.email);
    } catch (error) {
      if (!(error instanceof LinkStopped)) {
        logError('tracker identity link failed', error, extra);
        continue;
      }
      logError('tracker identity linking stopped', causeOf(error), extra);
      if (error.reason === 'rate_limited') throw causeOf(error);
      return;
    }
  }
}

export async function loginForLinearUser(
  deps: Pick<Deps, 'db'>,
  installationId: number,
  config: StandwiseConfig,
  logins: ReadonlySet<string>,
  user: { id: string; email: string | null },
): Promise<string | null> {
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
    if (matches[0]) return matches[0].toLowerCase();
  }
  const member = await findMemberByIdentity(deps.db, installationId, 'linear', user.id);
  if (!member || !logins.has(member.login.toLowerCase())) return null;
  return member.login.toLowerCase();
}
