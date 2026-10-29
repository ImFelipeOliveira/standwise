import { describe, expect, test } from 'bun:test';
import { resolveSession } from '@standwise/db';
import { GitHubOAuthError } from '@standwise/github';
import { db, useCleanDb } from '../../../db/test/setup';
import { completeWebLogin, type DomainError, hashNonce, signState, startWebLogin } from '../../src';
import { fakeDeps, INST, seedOrg } from './fakes';

useCleanDb();

const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';
const codeOf = async (run: Promise<unknown>) =>
  ((await run.catch((e: unknown) => e)) as DomainError).code;

describe('startWebLogin', () => {
  test('builds the github authorize url with a nonce bound state', () => {
    const { deps } = fakeDeps();
    const { url, nonce } = startWebLogin(deps, { next: '/setup?installation_id=11' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://sw.test/auth/github/callback');
    expect(nonce.length).toBeGreaterThan(20);
    expect(stateOf(url)).toContain('.');
  });
});

describe('completeWebLogin', () => {
  test('creates a web session and returns the sanitized next', async () => {
    await seedOrg();
    const { deps } = fakeDeps();
    const { url, nonce } = startWebLogin(deps, { next: '/setup?installation_id=11' });
    const result = await completeWebLogin(deps, { code: 'c', state: stateOf(url), nonce });
    expect(result.next).toBe('/setup?installation_id=11');
    expect((await resolveSession(db, result.token, 'web'))?.login).toBe('Alice');
  });

  test('sanitizes an unsafe next carried by a signed state', async () => {
    const { deps } = fakeDeps();
    const state = signState(
      deps.env.sessionSecret,
      { kind: 'login', next: 'https://evil.com', nonceHash: hashNonce('n') },
      deps.now(),
    );
    const result = await completeWebLogin(deps, { code: 'c', state, nonce: 'n' });
    expect(result.next).toBe('/');
  });

  test('rejects a bad state', async () => {
    const { deps } = fakeDeps();
    expect(await codeOf(completeWebLogin(deps, { code: 'c', state: 'x.y', nonce: 'n' }))).toBe(
      'invalid_state',
    );
  });

  test('rejects a missing or different nonce', async () => {
    const { deps } = fakeDeps();
    const { url } = startWebLogin(deps, {});
    const state = stateOf(url);
    expect(await codeOf(completeWebLogin(deps, { code: 'c', state, nonce: undefined }))).toBe(
      'invalid_state',
    );
    expect(await codeOf(completeWebLogin(deps, { code: 'c', state, nonce: 'other' }))).toBe(
      'invalid_state',
    );
  });

  test('maps an oauth failure to unauthorized', async () => {
    const { deps } = fakeDeps({
      webCode: async () => {
        throw new GitHubOAuthError('bad_verification_code');
      },
    });
    const { url, nonce } = startWebLogin(deps, {});
    expect(await codeOf(completeWebLogin(deps, { code: 'c', state: stateOf(url), nonce }))).toBe(
      'unauthorized',
    );
  });

  test('rethrows non oauth failures', async () => {
    const boom = new Error('network down');
    const { deps } = fakeDeps({
      webCode: async () => {
        throw boom;
      },
    });
    const { url, nonce } = startWebLogin(deps, {});
    expect(
      await completeWebLogin(deps, { code: 'c', state: stateOf(url), nonce }).catch(
        (e: unknown) => e,
      ),
    ).toBe(boom);
  });

  test('maps access_denied to its own code', async () => {
    const { deps } = fakeDeps();
    const { url, nonce } = startWebLogin(deps, {});
    expect(
      await codeOf(
        completeWebLogin(deps, {
          code: undefined,
          state: stateOf(url),
          nonce,
          error: 'access_denied',
        }),
      ),
    ).toBe('access_denied');
  });

  test('installation constant is seeded', () => {
    expect(INST).toBe(11);
  });
});
