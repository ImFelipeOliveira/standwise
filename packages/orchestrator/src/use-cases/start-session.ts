import {
  createSession,
  getConnectionExternalId,
  getInstallation,
  type MemberRow,
  revokeSession,
  setMemberInstallations,
  upsertMember,
} from '@standwise/db';
import type { Deps } from '../deps';
import { rememberGitHubInstallations } from '../github-installations';
import { linkChatIdentities } from '../identity';
import { forgetMembership, statusOf } from '../membership';
import { enqueueLinkTrackerIdentity } from '../tracker-identity';
import { DomainError } from './errors';

export type StartSessionResult = {
  token: string;
  login: string;
  orgs: { installationId: number; login: string }[];
};

export async function syncMemberFromGitHub(
  deps: Deps,
  githubToken: string,
): Promise<{ member: MemberRow; known: { id: number; accountLogin: string }[] }> {
  const profile = await deps.github
    .getUserProfile(githubToken, { appId: Number(deps.env.appId) })
    .catch((error: unknown) => {
      const status = statusOf(error);
      if (status === 401 || status === 403) {
        throw new DomainError('unauthorized', 'GitHub token invalid or expired');
      }
      throw error;
    });
  const member = await upsertMember(deps.db, {
    githubUserId: profile.githubUserId,
    login: profile.login,
    email: profile.email,
  });
  rememberGitHubInstallations(deps, member.id, profile.installationIds);
  const known: { id: number; accountLogin: string }[] = [];
  for (const id of profile.installationIds) {
    const installation = await getInstallation(deps.db, id);
    if (installation) known.push({ id, accountLogin: installation.accountLogin });
  }
  const ids = known.map((i) => i.id);
  forgetMembership(deps, profile.installationIds, member.id);
  await setMemberInstallations(deps.db, member.id, ids);
  await linkChatIdentities(deps, member.id, profile.email, ids);
  for (const id of ids) {
    if (await getConnectionExternalId(deps.db, id, 'linear')) {
      await enqueueLinkTrackerIdentity(deps, id, member.id);
    }
  }
  return { member, known };
}

export async function startSession(
  deps: Deps,
  input: { githubToken: string },
): Promise<StartSessionResult> {
  const { member, known } = await syncMemberFromGitHub(deps, input.githubToken);
  const token = await createSession(deps.db, member.id, 'cli');
  return {
    token,
    login: member.login,
    orgs: known.map((i) => ({ installationId: i.id, login: i.accountLogin })),
  };
}

export async function endSession(deps: Deps, token: string): Promise<void> {
  await revokeSession(deps.db, token);
}
