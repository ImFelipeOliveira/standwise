import { describe, expect, test } from 'bun:test';
import { getIdentities, saveConnection, setIdentity } from '@standcast/db';
import { db, useCleanDb } from '../../db/test/setup';
import { forgetChatIdentity, linkChatIdentities } from '../src';
import { fakeDeps, INST, seedMember, seedOrg } from './use-cases/fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);

const connectSlack = (teamId = 'T1', inst = INST) =>
  saveConnection(db, inst, 'slack', teamId, 'xoxb-1', KEY, 'Acme Workspace');

describe('linkChatIdentities', () => {
  test('links the slack user of the connected team', async () => {
    await seedOrg();
    await connectSlack();
    const member = await seedMember();
    const { deps } = fakeDeps();
    await linkChatIdentities(deps, member.id, 'alice@acme.com', [INST]);
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U9');
  });

  test('links nothing without a slack connection', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps } = fakeDeps();
    await linkChatIdentities(deps, member.id, 'alice@acme.com', [INST]);
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });

  test('a slack reconnect to another team during the lookup writes nothing', async () => {
    await seedOrg();
    await connectSlack('T1');
    const member = await seedMember();
    const { deps } = fakeDeps();
    deps.chatFor = async () =>
      ({
        findUserByEmail: async () => {
          await connectSlack('T2');
          return 'U9';
        },
      }) as never;
    await linkChatIdentities(deps, member.id, 'alice@acme.com', [INST]);
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });
});

describe('forgetChatIdentity', () => {
  test('deletes the stored slack identity that failed, only in that installation', async () => {
    await seedOrg();
    await seedOrg(undefined, { id: 12, accountLogin: 'other' });
    const member = await seedMember();
    await setIdentity(db, INST, member.id, 'slack', 'U1');
    await setIdentity(db, 12, member.id, 'slack', 'U1');
    await setIdentity(db, INST, member.id, 'linear', 'lin-1');
    await forgetChatIdentity({ db }, INST, 'ALICE', 'U1');
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
    expect((await getIdentities(db, 12, 'slack')).get('alice')).toBe('U1');
    expect((await getIdentities(db, INST, 'linear')).get('alice')).toBe('lin-1');
  });

  test('keeps the stored identity when the failing id is another one', async () => {
    await seedOrg();
    const member = await seedMember();
    await setIdentity(db, INST, member.id, 'slack', 'U1');
    await forgetChatIdentity({ db }, INST, 'alice', 'U0OVERRIDE');
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U1');
  });
});
