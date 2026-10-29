import {
  createSession,
  getInstallation,
  setMemberInstallations,
  upsertMember,
} from '@standwise/db';
import type { Deps } from '../deps';
import { linkChatIdentities } from '../identity';
import { DomainError } from './errors';

export type StartSessionResult = {
  token: string;
  login: string;
  orgs: { installationId: number; login: string }[];
};

export async function startSession(
  deps: Deps,
  input: { githubToken: string },
): Promise<StartSessionResult> {
  const profile = await deps.github
    .getUserProfile(input.githubToken, { appId: Number(deps.env.appId) })
    .catch((error: unknown) => {
      const status = (error as { status?: unknown } | null)?.status;
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
  const known: { id: number; accountLogin: string }[] = [];
  for (const id of profile.installationIds) {
    const installation = await getInstallation(deps.db, id);
    if (installation) known.push({ id, accountLogin: installation.accountLogin });
  }
  const ids = known.map((i) => i.id);
  await setMemberInstallations(deps.db, member.id, ids);
  await linkChatIdentities(deps, member.id, profile.email, ids);
  const token = await createSession(deps.db, member.id, 'cli');
  return {
    token,
    login: member.login,
    orgs: known.map((i) => ({ installationId: i.id, login: i.accountLogin })),
  };
}
