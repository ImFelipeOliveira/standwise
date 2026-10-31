import { describe, expect, test } from 'bun:test';
import {
  getConnection,
  getIdentities,
  saveConnection,
  setIdentity,
  setMemberInstallations,
  upsertInstallation,
} from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  completeSlackConnect,
  createMembershipCheck,
  type DomainError,
  getSetupStatus,
  hashSessionToken,
  signState,
  startSlackConnect,
} from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);
const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';
const codeOf = async (run: Promise<unknown>) =>
  ((await run.catch((e: unknown) => e)) as DomainError).code;

async function setup(opts: Parameters<typeof fakeDeps>[0] = {}) {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const harness = fakeDeps(opts);
  harness.roles.set('alice', { role: 'admin', state: 'active' });
  return { ...harness, member, isMember: createMembershipCheck(harness.deps) };
}

describe('startSlackConnect', () => {
  test('builds the slack authorize url with a session bound state', async () => {
    const { deps, member, isMember } = await setup();
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://sw.test/oauth/slack/callback');
    expect(stateOf(url)).toContain('.');
  });

  test('forbids a member who is not an admin', async () => {
    const { deps, member, isMember, roles } = await setup();
    roles.set('alice', { role: 'member', state: 'active' });
    expect(
      await codeOf(
        startSlackConnect(deps, isMember, member, { sessionToken: 'tok', installationId: INST }),
      ),
    ).toBe('forbidden');
  });
});

describe('completeSlackConnect', () => {
  test('saves the connection with the workspace name', async () => {
    const { deps, member, isMember } = await setup();
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    const result = await completeSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      code: 'c',
      state: stateOf(url),
    });
    expect(result).toEqual({ installationId: INST });
    expect(await getConnection(db, INST, 'slack', KEY)).toEqual({
      externalId: 'T1',
      externalName: 'Acme Workspace',
      secret: 'xoxb-1',
    });
  });

  test('connecting another workspace clears the slack identities', async () => {
    const { deps, member, isMember } = await setup();
    await saveConnection(db, INST, 'slack', 'T0OLD', 'xoxb-old', KEY, 'Old');
    await setIdentity(db, INST, member.id, 'slack', 'U0OLD');
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    await completeSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      code: 'c',
      state: stateOf(url),
    });
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });

  test('reconnecting the same workspace keeps the slack identities', async () => {
    const { deps, member, isMember } = await setup();
    await saveConnection(db, INST, 'slack', 'T1', 'xoxb-old', KEY, 'Acme Workspace');
    await setIdentity(db, INST, member.id, 'slack', 'U0SAME');
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    await completeSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      code: 'c',
      state: stateOf(url),
    });
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U0SAME');
  });

  test('forbids a non admin callback and saves nothing', async () => {
    const { deps, member, isMember, roles } = await setup();
    roles.set('alice', { role: 'member', state: 'active' });
    const state = signState(
      deps.env.sessionSecret,
      { kind: 'slack', installationId: INST, sessionHash: hashSessionToken('tok') },
      deps.now(),
    );
    expect(
      await codeOf(
        completeSlackConnect(deps, isMember, member, { sessionToken: 'tok', code: 'c', state }),
      ),
    ).toBe('forbidden');
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
  });

  test('forbids an admin demoted between start and callback', async () => {
    const { deps, member, isMember, roles } = await setup();
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    roles.set('alice', { role: 'member', state: 'active' });
    expect(
      await codeOf(
        completeSlackConnect(deps, isMember, member, {
          sessionToken: 'tok',
          code: 'c',
          state: stateOf(url),
        }),
      ),
    ).toBe('forbidden');
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
  });

  test('rejects a state bound to another session', async () => {
    const { deps, member, isMember } = await setup();
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    expect(
      await codeOf(
        completeSlackConnect(deps, isMember, member, {
          sessionToken: 'other',
          code: 'c',
          state: stateOf(url),
        }),
      ),
    ).toBe('invalid_state');
    expect(await getConnection(db, INST, 'slack', KEY)).toBeNull();
  });

  test('rejects a state for an installation the member cannot access', async () => {
    const { deps, member, isMember, orgMembers } = await setup();
    orgMembers.delete('alice');
    await upsertInstallation(db, { id: 12, accountLogin: 'other', accountType: 'Organization' });
    const state = signState(
      deps.env.sessionSecret,
      { kind: 'slack', installationId: 12, sessionHash: hashSessionToken('tok') },
      deps.now(),
    );
    expect(
      await codeOf(
        completeSlackConnect(deps, isMember, member, { sessionToken: 'tok', code: 'c', state }),
      ),
    ).toBe('forbidden');
    expect(await getConnection(db, 12, 'slack', KEY)).toBeNull();
  });

  test('maps a slack exchange failure to slack_oauth_failed', async () => {
    const { deps, member, isMember } = await setup({
      slackExchange: async () => {
        throw new ChatDeliveryError('invalid_code', 'bad code');
      },
    });
    const { url } = await startSlackConnect(deps, isMember, member, {
      sessionToken: 'tok',
      installationId: INST,
    });
    expect(
      await codeOf(
        completeSlackConnect(deps, isMember, member, {
          sessionToken: 'tok',
          code: 'c',
          state: stateOf(url),
        }),
      ),
    ).toBe('slack_oauth_failed');
  });

  test('maps slack access_denied to access_denied', async () => {
    const { deps, member, isMember } = await setup();
    expect(
      await codeOf(
        completeSlackConnect(deps, isMember, member, {
          sessionToken: 'tok',
          code: undefined,
          state: undefined,
          error: 'access_denied',
        }),
      ),
    ).toBe('access_denied');
  });
});

describe('getSetupStatus', () => {
  test('summarizes config, repo, slack and failures', async () => {
    const { deps, member, isMember } = await setup();
    const status = await getSetupStatus(deps, isMember, member, INST);
    expect(status).toMatchObject({
      installationId: INST,
      owner: 'acme',
      config: { status: 'configured' },
      configRepo: { exists: true, defaultBranch: 'trunk' },
      slack: { connected: false },
      teamFailures: [],
      personFailures: [],
      supportEmail: 'help@sw.test',
    });
  });

  test('reports a missing .github repository', async () => {
    const { deps, member, isMember } = await setup({ configRepo: 'missing' });
    expect((await getSetupStatus(deps, isMember, member, INST)).configRepo).toEqual({
      exists: false,
    });
  });

  test('rethrows unexpected github errors', async () => {
    const { deps, member, isMember } = await setup({ configRepo: 'error' });
    const error = await getSetupStatus(deps, isMember, member, INST).catch((e: unknown) => e);
    expect((error as { status?: number }).status).toBe(500);
  });
});
