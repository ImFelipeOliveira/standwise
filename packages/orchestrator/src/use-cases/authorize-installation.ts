import {
  getInstallation,
  type InstallationRow,
  listMemberInstallations,
  type MemberRow,
  removeMemberInstallation,
} from '@standwise/db';
import type { Deps } from '../deps';
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
  const linked = (await listMemberInstallations(deps.db, member.id)).some(
    (i) => i.installationId === installationId,
  );
  const installation = linked ? await getInstallation(deps.db, installationId) : null;
  if (!installation) throw forbidden();
  const current = await isMember(installation, member);
  if (!current) {
    await removeMemberInstallation(deps.db, member.id, installationId);
    throw forbidden();
  }
  return { member: current, installation };
}
