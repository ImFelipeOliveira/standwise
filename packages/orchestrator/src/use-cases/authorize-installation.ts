import {
  addMemberInstallation,
  getInstallation,
  type InstallationRow,
  listMemberInstallations,
  type MemberRow,
  removeMemberInstallation,
} from '@standcast/db';
import type { Deps } from '../deps';
import { isOwnGitHubInstallation } from '../github-installations';
import { DomainError } from './errors';
import type { MembershipCheck } from './org-context';

export async function authorizeInstallation(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number | undefined,
): Promise<{ member: MemberRow; installation: InstallationRow }> {
  const forbidden = () =>
    new DomainError('forbidden', 'you do not have access to this installation');
  if (installationId === undefined || !Number.isInteger(installationId)) throw forbidden();
  const installation = await getInstallation(deps.db, installationId);
  if (!installation) {
    if (!isOwnGitHubInstallation(deps, member.id, installationId)) throw forbidden();
    throw new DomainError('installation_pending', 'installation is still being processed');
  }
  const linked = (await listMemberInstallations(deps.db, member.id)).some(
    (i) => i.installationId === installationId,
  );
  const current = await isMember(installation, member);
  if (!current) {
    if (linked) await removeMemberInstallation(deps.db, member.id, installationId);
    throw forbidden();
  }
  if (!linked) await addMemberInstallation(deps.db, member.id, installationId);
  return { member: current, installation };
}
