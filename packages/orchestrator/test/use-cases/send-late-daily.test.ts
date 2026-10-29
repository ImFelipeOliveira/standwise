import { describe, expect, test } from 'bun:test';
import { claimDelivery, completeDelivery, getDelivery, upsertDaily } from '@standwise/db';
import { ChatDeliveryError } from '@standwise/slack';
import { db, useCleanDb } from '../../../db/test/setup';
import { sendLateDaily } from '../../src';
import { daily, fakeChat, fakeDeps, flakyDb, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const DATE = '2026-10-28';
const digestKey = { installationId: INST, teamName: 'Alpha', date: DATE, kind: 'digest' as const };
const DIGEST_REF = { channel: 'C1', id: '100.0' };

async function setup(digestSent = true) {
  await seedOrg();
  const alice = await seedMember();
  await upsertDaily(db, {
    installationId: INST,
    memberId: alice.id,
    date: DATE,
    payload: { ...daily, today: [{ text: 'late work' }] },
    submittedAt: new Date('2026-10-28T14:00:00Z'),
  });
  if (digestSent) {
    const claim = await claimDelivery(db, digestKey);
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await completeDelivery(db, digestKey, claim.token, DIGEST_REF);
  }
  const fake = fakeDeps();
  const chat = fakeChat();
  fake.deps.chatFor = async () => chat.chat;
  return { ...fake, ...chat, job: { installationId: INST, memberId: alice.id, date: DATE } };
}

describe('sendLateDaily', () => {
  test('late daily replies in thread', async () => {
    const { deps, replies, posted, job } = await setup();
    await sendLateDaily(deps, job);
    await sendLateDaily(deps, job);
    expect(posted).toHaveLength(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.ref).toEqual(DIGEST_REF);
    expect(replies[0]?.msg.fallbackText).toContain('late work');
    const row = await getDelivery(db, {
      ...digestKey,
      kind: 'late_daily',
      subject: job.memberId,
    });
    expect(row?.status).toBe('sent');
  });

  test('no reply when the digest was not sent', async () => {
    const { deps, replies, job } = await setup(false);
    await sendLateDaily(deps, job);
    expect(replies).toHaveLength(0);
  });

  test('late daily failure is recorded and rethrown', async () => {
    const { deps, replies, failWith, job } = await setup();
    failWith(new ChatDeliveryError('channel_not_found', 'gone'));
    await expect(sendLateDaily(deps, job)).rejects.toBeInstanceOf(ChatDeliveryError);
    const row = await getDelivery(db, {
      ...digestKey,
      kind: 'late_daily',
      subject: job.memberId,
    });
    expect(row?.status).toBe('failed');
    expect(row?.error?.startsWith('channel_not_found')).toBe(true);
    failWith(null);
    await sendLateDaily(deps, job);
    expect(replies).toHaveLength(1);
  });

  test('no chat connection is recorded as failed', async () => {
    const { deps, job } = await setup();
    deps.chatFor = async () => null;
    await sendLateDaily(deps, job);
    const row = await getDelivery(db, {
      ...digestKey,
      kind: 'late_daily',
      subject: job.memberId,
    });
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('no_chat_connection');
  });

  test('a failed completion after replying leaves the delivery pending', async () => {
    const { deps, hooks, job } = await setup();
    const flaky = flakyDb();
    deps.db = flaky.db;
    hooks.afterSend = async () => flaky.failNextUpdate();
    await expect(sendLateDaily(deps, job)).rejects.toThrow('db down');
    const row = await getDelivery(db, {
      ...digestKey,
      kind: 'late_daily',
      subject: job.memberId,
    });
    expect(row?.status).toBe('pending');
  });
});
