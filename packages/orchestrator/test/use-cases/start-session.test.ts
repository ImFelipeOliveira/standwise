import { describe, expect, test } from 'bun:test';
import { getIdentities, listMemberInstallations, resolveSession } from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import { db, useCleanDb } from '../../../db/test/setup';
import { DomainError, startSession } from '../../src';
import { fakeDeps, INST, seedOrg } from './fakes';

useCleanDb();

describe('startSession', () => {
  test('creates member, keeps known installations and links slack', async () => {
    await seedOrg();
    const { deps } = fakeDeps();
    const result = await startSession(deps, { githubToken: 'gho_x' });
    expect(result.token.startsWith('sw_')).toBe(true);
    expect(result.login).toBe('Alice');
    expect(result.orgs).toEqual([{ installationId: INST, login: 'acme' }]);
    const member = await resolveSession(db, result.token, 'cli');
    expect(member?.githubUserId).toBe(1);
    expect(
      (await listMemberInstallations(db, member?.id ?? '')).map((i) => i.installationId),
    ).toEqual([INST]);
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U9');
  });

  test('maps github 401 and 403 to unauthorized', async () => {
    for (const status of [401, 403]) {
      const { deps } = fakeDeps({ profileError: Object.assign(new Error('bad'), { status }) });
      const error = await startSession(deps, { githubToken: 'gho_x' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('unauthorized');
    }
  });

  test('other github failures propagate', async () => {
    const boom = Object.assign(new Error('boom'), { status: 500 });
    const { deps } = fakeDeps({ profileError: boom });
    expect(await startSession(deps, { githubToken: 'gho_x' }).catch((e: unknown) => e)).toBe(boom);
  });

  test('slack failure is tolerated', async () => {
    await seedOrg();
    const { deps } = fakeDeps({
      findUserError: new ChatDeliveryError('token_revoked', 'revoked'),
    });
    const result = await startSession(deps, { githubToken: 'gho_x' });
    expect(result.orgs).toHaveLength(1);
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });
});
