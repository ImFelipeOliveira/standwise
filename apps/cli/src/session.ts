import { t } from '@standwise/core';
import { DEFAULT_API_URL } from './api';
import { type Credentials, readCredentials } from './credentials';
import { type Ctx, EXIT, ExitError } from './io';

export function apiUrlFor({ io, flags }: Ctx, stored?: Credentials | null): string {
  return flags.apiUrl || io.env.STANDWISE_API_URL || stored?.apiUrl || DEFAULT_API_URL;
}

export async function requireCredentials(ctx: Ctx): Promise<Credentials> {
  const credentials = await readCredentials(ctx.io.env);
  if (!credentials) throw new ExitError(EXIT.unauthenticated, t(ctx.lang, 'cli.notLoggedIn'));
  return credentials;
}

export function resolveOrg(ctx: Ctx, credentials: Credentials): string {
  if (ctx.flags.org) return ctx.flags.org;
  const [only, ...rest] = credentials.orgs;
  if (only && rest.length === 0) return only.login;
  if (!only) throw new ExitError(EXIT.ambiguousOrg, t(ctx.lang, 'cli.noOrgs'));
  const orgs = credentials.orgs.map((org) => org.login).join(', ');
  throw new ExitError(EXIT.ambiguousOrg, t(ctx.lang, 'cli.ambiguousOrg', { orgs }));
}
