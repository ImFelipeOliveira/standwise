import { createSession } from '@standwise/db';
import type { Deps } from '../deps';
import { verifyState } from '../state-token';
import { DomainError } from './errors';
import { syncMemberFromGitHub } from './start-session';
import { sanitizeNext } from './start-web-login';

export async function completeWebLogin(
  deps: Deps,
  input: { code: string | undefined; state: string | undefined },
): Promise<{ token: string; next: string }> {
  const state = input.state
    ? verifyState(deps.env.sessionSecret, input.state, 'login', deps.now())
    : null;
  if (!state || !input.code)
    throw new DomainError('invalid_state', 'invalid or expired login state');
  const githubToken = await deps.github.exchangeWebCode(input.code).catch(() => {
    throw new DomainError('unauthorized', 'GitHub authorization failed');
  });
  const { member } = await syncMemberFromGitHub(deps, githubToken);
  const token = await createSession(deps.db, member.id, 'web');
  return { token, next: sanitizeNext(state.next) };
}
