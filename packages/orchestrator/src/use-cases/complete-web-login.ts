import { createSession } from '@standwise/db';
import { GitHubOAuthError } from '@standwise/github';
import type { Deps } from '../deps';
import { hashesMatch, hashNonce, verifyState } from '../state-token';
import { DomainError } from './errors';
import { syncMemberFromGitHub } from './start-session';
import { sanitizeNext } from './start-web-login';

export async function completeWebLogin(
  deps: Deps,
  input: {
    code: string | undefined;
    state: string | undefined;
    nonce: string | undefined;
    error?: string | undefined;
  },
): Promise<{ token: string; next: string }> {
  if (input.error === 'access_denied') {
    throw new DomainError('access_denied', 'GitHub authorization was denied');
  }
  const state = input.state
    ? verifyState(deps.env.sessionSecret, input.state, 'login', deps.now())
    : null;
  if (
    !state ||
    !input.code ||
    !input.nonce ||
    !hashesMatch(state.nonceHash, hashNonce(input.nonce))
  ) {
    throw new DomainError('invalid_state', 'invalid or expired login state');
  }
  const githubToken = await deps.github.exchangeWebCode(input.code).catch((error: unknown) => {
    if (error instanceof GitHubOAuthError) {
      throw new DomainError('unauthorized', 'GitHub authorization failed');
    }
    throw error;
  });
  const { member } = await syncMemberFromGitHub(deps, githubToken);
  const token = await createSession(deps.db, member.id, 'web');
  return { token, next: sanitizeNext(state.next) };
}
