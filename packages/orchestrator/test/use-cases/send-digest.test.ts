import { describe, expect, test } from 'bun:test';
import type { StandwiseConfig } from '@standwise/core';
import {
  getDelivery,
  setIdentity,
  setInstallationConfig,
  upsertDaily,
  upsertMember,
} from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import { db, useCleanDb } from '../../../db/test/setup';
import { DIGEST_POST_DEADLINE_MS, sendDigest, sendLateDaily } from '../../src';
import { config, daily, fakeChat, fakeDeps, flakyDb, INST, seedMember, seedOrg } from './fakes';

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

  test('digest uses the last valid config while standwise.yml is invalid', async () => {
    const { deps, posted } = await setup();
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    await sendDigest(deps, job);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.channel).toBe('#alpha');
  });

  test('digest marks missing and unknown identity', async () => {
    const { deps, posted } = await setup();
    await upsertMember(db, { githubUserId: 2, login: 'bob', email: null });
    await sendDigest(deps, job);
    const text = posted[0]?.msg.fallbackText ?? '';
    expect(text).toContain('@UALICE');
    expect(text).toContain('did a thing');
    expect(text).toContain('Did not send the daily');
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

  test('daily submitted mid-digest gets a late reply', async () => {
    const { deps, hooks, queue, replies, alice } = await setup();
    const bob = await upsertMember(db, { githubUserId: 2, login: 'bob', email: null });
    hooks.afterSend = async () => {
      hooks.afterSend = undefined;
      await upsertDaily(db, {
        installationId: INST,
        memberId: bob.id,
        date: DATE,
        payload: { ...daily, today: [{ text: 'bob in flight' }] },
        submittedAt: new Date('2026-10-28T13:00:01Z'),
      });
      await upsertDaily(db, {
        installationId: INST,
        memberId: alice.id,
        date: DATE,
        payload: { ...daily, today: [{ text: 'alice changed' }] },
        submittedAt: new Date('2026-10-28T13:00:02Z'),
      });
    };
    await sendDigest(deps, job);
    const late = queue.enqueued.filter((j) => j.name === 'send-late-daily');
    expect(late.map((j) => j.data)).toEqual([
      { installationId: INST, memberId: bob.id, date: DATE },
      { installationId: INST, memberId: alice.id, date: DATE },
    ]);
    await sendLateDaily(deps, { installationId: INST, memberId: bob.id, date: DATE });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.ref).toEqual({ channel: 'C1', id: '1.0' });
    expect(replies[0]?.msg.fallbackText).toContain('bob in flight');
  });

  test('missing keeps the login spelling', async () => {
    const { deps, posted } = await setup(config('[alice, Bob, carol]'));
    await upsertMember(db, { githubUserId: 3, login: 'Carol', email: null });
    await sendDigest(deps, job);
    const text = posted[0]?.msg.fallbackText ?? '';
    expect(text).toContain('@Bob');
    expect(text).toContain('@Carol');
  });

  test('a failed completion after posting leaves the delivery pending', async () => {
    const { deps, hooks } = await setup();
    const flaky = flakyDb();
    deps.db = flaky.db;
    hooks.afterSend = async () => flaky.failNextUpdate();
    await expect(sendDigest(deps, job)).rejects.toThrow('db down');
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('pending');
  });

  test('an attempt past its deadline fails before posting', async () => {
    const { deps, posted, setNow } = await setup();
    const resolve = deps.github.resolveTeamMembers;
    deps.github.resolveTeamMembers = async (...args) => {
      setNow(new Date(deps.now().getTime() + DIGEST_POST_DEADLINE_MS + 1));
      return resolve(...args);
    };
    const error = await sendDigest(deps, job).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatDeliveryError);
    expect(posted).toHaveLength(0);
    const row = await getDelivery(db, key);
    expect(row?.status).toBe('failed');
    expect(row?.error?.startsWith('deadline_exceeded')).toBe(true);
  });

  test('a member who never logged in is mentioned by the config slack id', async () => {
    const { deps, posted } = await setup(
      config('[alice, bob]', 'members:\n  Bob: { slack: U0BOB }\n  alice: { slack: U0CONF }'),
    );
    await sendDigest(deps, job);
    const text = posted[0]?.msg.fallbackText ?? '';
    expect(text).toContain('@U0BOB');
    expect(text).toContain('@U0CONF');
    expect(text).not.toContain('@UALICE');
    expect(text).not.toContain('@bob');
  });
});
