import { stripUnsafeChars, t } from '@standwise/core';
import { DEFAULT_API_URL } from './api';
import { type Credentials, readCredentials } from './credentials';
import { type Ctx, EXIT, ExitError } from './io';
import { assertSafeUrl } from './url';

export function loginApiUrl({ io, flags, lang }: Ctx): string {
  const url = flags.apiUrl || io.env.STANDWISE_API_URL || DEFAULT_API_URL;
  assertSafeUrl(url, lang);
  return url;
}

export async function requireCredentials(ctx: Ctx): Promise<Credentials> {
  const credentials = await readCredentials(ctx.io.env);
  if (!credentials) throw new ExitError(EXIT.unauthenticated, t(ctx.lang, 'cli.notLoggedIn'));
  return credentials;
}

export async function requireBoundCredentials(
  ctx: Ctx,
): Promise<{ credentials: Credentials; apiUrl: string }> {
  const credentials = await requireCredentials(ctx);
  const apiUrl = ctx.flags.apiUrl || ctx.io.env.STANDWISE_API_URL || credentials.apiUrl;
  const effective = assertSafeUrl(apiUrl, ctx.lang);
  const stored = assertSafeUrl(credentials.apiUrl, ctx.lang);
  if (effective.origin !== stored.origin) {
    throw new ExitError(
      EXIT.unauthenticated,
      t(ctx.lang, 'cli.originMismatch', { url: stripUnsafeChars(effective.origin) }),
    );
  }
  return { credentials, apiUrl: credentials.apiUrl };
}

export function resolveOrg(ctx: Ctx, credentials: Credentials): string {
  if (ctx.flags.org) return ctx.flags.org;
  const [only, ...rest] = credentials.orgs;
  if (only && rest.length === 0) return only.login;
  if (!only) throw new ExitError(EXIT.ambiguousOrg, t(ctx.lang, 'cli.noOrgs'));
  const orgs = credentials.orgs.map((org) => org.login).join(', ');
  throw new ExitError(EXIT.ambiguousOrg, t(ctx.lang, 'cli.ambiguousOrg', { orgs }));
}
