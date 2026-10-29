import { githubAuthorizeUrl } from '@standwise/github';
import type { Deps } from '../deps';
import { signState } from '../state-token';

const hasControlChars = (value: string) =>
  [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

export function sanitizeNext(next: string | undefined): string {
  if (!next?.startsWith('/') || hasControlChars(next)) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

export function startWebLogin(deps: Deps, input: { next?: string }): { url: string } {
  const state = signState(
    deps.env.sessionSecret,
    { kind: 'login', next: sanitizeNext(input.next) },
    deps.now(),
  );
  return {
    url: githubAuthorizeUrl({
      clientId: deps.env.githubClientId,
      redirectUri: `${deps.env.publicUrl}/auth/github/callback`,
      state,
    }),
  };
}
