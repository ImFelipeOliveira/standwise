import { describe, expect, test } from 'bun:test';
import type { StandwiseConfig } from '@standwise/core';
import { getDelivery, setIdentity, upsertDaily, upsertMember } from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import { db, useCleanDb } from '../../../db/test/setup';
import { sendDigest } from '../../src';
import { config, daily, fakeChat, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const DATE = '2026-10-28';
const job = { installationId: INST, teamName: 'Alpha', date: DATE };
const key = { installationId: INST, teamName: 'Alpha', date: DATE, kind: 'digest' as const };

async function setup(cfg: StandwiseConfig = config()) {
  await seedOrg(cfg);
  const alice = await seedMember();
  await setIdentity(db, INST, alice.id, 'slack', 'UALICE');
  await upsertDaily(db, {
    installationId: INST,
    memberId: alice.id,
    date: DATE,
    payload: daily,
    submittedAt: new Date('2026-10-28T12:00:00Z'),
  });
  const fake = fakeDeps();
  const chat = fakeChat();
  fake.deps.chatFor = async () => chat.chat;
  return { ...fake, ...chat, alice };
}

describe('sendDigest', () => {
  test('digest posts once', async () => {
    const { deps, posted } = await setup();
    await Promise.all([sendDigest(deps, job), sendDigest(deps, job)]);
    await sendDigest(deps, job);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.channel).toBe('#alpha');
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('sent');
    expect(row?.ref).toEqual({ channel: 'C1', id: '1.0' });
  });

  test('digest marks missing and unknown identity', async () => {
    const { deps, posted } = await setup();
    await upsertMember(db, { githubUserId: 2, login: 'bob', email: null });
    await sendDigest(deps, job);
    const text = posted[0]?.msg.fallbackText ?? '';
    expect(text).toContain('@UALICE');
    expect(text).toContain('did a thing');
    expect(text).toContain('Não enviaram');
    expect(text).toContain('@bob');
  });

  test('digest only includes dailies of team members', async () => {
    const { deps, posted } = await setup(config('[bob]'));
    await sendDigest(deps, job);
    const text = posted[0]?.msg.fallbackText ?? '';
    expect(text).not.toContain('did a thing');
    expect(text).toContain('@bob');
  });

  test('digest failure recorded', async () => {
    const { deps, posted, failWith } = await setup();
    failWith(new ChatDeliveryError('not_in_channel', 'bot is not in the channel'));
    for (let i = 0; i < 3; i++) {
      await expect(sendDigest(deps, job)).rejects.toBeInstanceOf(ChatDeliveryError);
    }
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(3);
    expect(row?.error?.startsWith('not_in_channel')).toBe(true);
    failWith(null);
    await sendDigest(deps, job);
    expect(posted).toHaveLength(0);
  });

  test('missing slack connection fails without retry', async () => {
    const { deps } = await setup();
    deps.chatFor = async () => null;
    await sendDigest(deps, job);
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('no_chat_connection');
  });

  test('unsupported provider fails without retry', async () => {
    const base = config();
    const team = base.teams[0];
    if (!team) throw new Error('no team');
    const { deps, posted } = await setup({
      ...base,
      teams: [{ ...team, chat: { provider: 'google-chat', channel: 'spaces/x' } }],
    });
    await sendDigest(deps, job);
    expect(posted).toHaveLength(0);
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('unsupported_provider');
  });

  test('removed team gets no digest', async () => {
    const { deps, posted } = await setup();
    await sendDigest(deps, { ...job, teamName: 'Gone' });
    expect(posted).toHaveLength(0);
    expect(await getDelivery(db, { ...key, teamName: 'Gone' })).toBeNull();
  });
});
