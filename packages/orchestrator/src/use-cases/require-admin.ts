import type { InstallationRow, MemberRow } from '@standwise/db';
import type { Deps } from '../deps';
import { authorizeInstallation } from './authorize-installation';
import { DomainError } from './errors';
import { isInstallationAdmin } from './is-installation-admin';
import type { MembershipCheck } from './org-context';

export async function requireAdmin(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number | undefined,
): Promise<{ member: MemberRow; installation: InstallationRow }> {
  const { member: current, installation } = await authorizeInstallation(
    deps,
    isMember,
    member,
    installationId,
  );
  if (!(await isInstallationAdmin(deps, installation.id, current, { fresh: true }))) {
    throw new DomainError('forbidden', 'only an organization admin can manage this installation');
  }
  return { member: current, installation };
}
