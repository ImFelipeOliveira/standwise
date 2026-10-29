import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  createApiKey,
  type MemberRow,
  revokeApiKey,
} from '@standwise/db';
import type { Deps } from '../deps';
import { authorizeInstallation } from './authorize-installation';
import { DomainError } from './errors';
import { isInstallationAdmin } from './is-installation-admin';
import type { MembershipCheck } from './org-context';
import { isUuid } from './pagination';

const MAX_NAME_LENGTH = 80;

export type CreateApiKeyInput = { installationId: number; name: string; scopes: ApiKeyScope[] };

async function requireAdmin(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number,
): Promise<MemberRow> {
  const { member: current, installation } = await authorizeInstallation(
    deps,
    isMember,
    member,
    installationId,
  );
  if (!(await isInstallationAdmin(deps, installation.id, current))) {
    throw new DomainError('forbidden', 'only an organization admin can manage api keys');
  }
  return current;
}

export async function createInstallationApiKey(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  input: CreateApiKeyInput,
): Promise<{ id: string; key: string }> {
  const current = await requireAdmin(deps, isMember, member, input.installationId);
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new DomainError('invalid_request', `name must have 1 to ${MAX_NAME_LENGTH} characters`);
  }
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0 || scopes.some((s) => !API_KEY_SCOPES.includes(s))) {
    throw new DomainError('invalid_request', 'scopes must be a non-empty list of known scopes');
  }
  return createApiKey(deps.db, {
    installationId: input.installationId,
    name,
    scopes,
    createdBy: current.id,
  });
}

export async function revokeInstallationApiKey(
  deps: Deps,
  isMember: MembershipCheck,
  member: MemberRow,
  installationId: number,
  keyId: string,
): Promise<boolean> {
  await requireAdmin(deps, isMember, member, installationId);
  if (!isUuid(keyId)) return false;
  return revokeApiKey(deps.db, installationId, keyId);
}
