import { describe, expect, test } from 'bun:test';
import { parseConfig, type StandcastConfig } from '@standcast/core';
import {
  claimDelivery,
  completeDelivery,
  getDelivery,
  getIdentities,
  setIdentity,
  setInstallationConfig,
  upsertDaily,
  upsertMember,
} from '@standcast/db';
import { ChatDeliveryError } from '@standcast/slack';
import { db, useCleanDb } from '../../../db/test/setup';
import { runTick, sendReminder } from '../../src';
import { config, daily, fakeChat, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const DATE = '2026-10-28';
const local = (iso: string) => new Date(`${iso}-03:00`);
const reminderKey = (login: string) => ({
  installationId: INST,
  teamName: '',
  date: DATE,
  kind: 'reminder' as const,
  subject: login,
});
const digestKey = (teamName = 'Alpha') => ({
  installationId: INST,
  teamName,
  date: DATE,
  kind: 'digest' as const,
});

function twoTeamsWithAlice(): StandcastConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice]
    chat: { provider: slack, channel: "#alpha" }
  - name: Beta
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "11:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#beta" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

async function setup(cfg: StandcastConfig = config()) {
  await seedOrg(cfg);
  const fake = fakeDeps();
  fake.setNow(local('2026-10-28T09:00:00'));
  const chat = fakeChat();
  fake.deps.chatFor = async () => chat.chat;
  return { ...fake, ...chat };
}

async function markSent(teamName = 'Alpha') {
  const key = digestKey(teamName);
  const claim = await claimDelivery(db, key);
  if (claim.status !== 'claimed') throw new Error('not claimed');
  await completeDelivery(db, key, claim.token, { channel: 'C1', id: '1' });
}

let nextGithubId = 100;
async function identify(login: string, chatUserId: string) {
  const member = await upsertMember(db, {
    githubUserId: nextGithubId++,
    login,
    email: `${login}@acme.com`,
  });
  await setIdentity(db, INST, member.id, 'slack', chatUserId);
}

const job = (login: string) => ({ installationId: INST, login, date: DATE });

describe('runTick reminders', () => {
  const reminders = (f: { queue: { enqueued: { name: string; data: unknown }[] } }) =>
    f.queue.enqueued.filter((j) => j.name === 'send-reminder').map((j) => j.data);

  test('one job per missing member at remind_at, none before', async () => {
    const early = await setup();
    early.setNow(local('2026-10-28T08:59:00'));
    await runTick(early.deps);
    expect(reminders(early)).toEqual([]);

    const fake = await setup();
    await runTick(fake.deps);
    expect(reminders(fake)).toEqual([
      { installationId: INST, login: 'alice', date: DATE },
      { installationId: INST, login: 'bob', date: DATE },
    ]);
  });

  test('members who already sent are skipped', async () => {
    const fake = await setup();
    const alice = await seedMember();
    await upsertDaily(db, {
      installationId: INST,
      memberId: alice.id,
      date: DATE,
      payload: daily,
      submittedAt: new Date('2026-10-28T11:30:00Z'),
    });
    await runTick(fake.deps);
    expect(reminders(fake)).toEqual([{ installationId: INST, login: 'bob', date: DATE }]);
  });

  test('no reminders on a weekend', async () => {
    const fake = await setup();
    fake.setNow(local('2026-10-31T09:00:00'));
    await runTick(fake.deps);
    expect(reminders(fake)).toEqual([]);
  });

  test('a delayed tick after the digest was sent sends no reminder', async () => {
    const fake = await setup();
    await markSent();
    fake.setNow(local('2026-10-28T10:30:00'));
    await runTick(fake.deps);
    expect(reminders(fake)).toEqual([]);
  });
});

describe('sendReminder', () => {
  test('sends one DM and is idempotent', async () => {
    const { deps, directs } = await setup();
    await identify('alice', 'U1');
    await sendReminder(deps, job('alice'));
    await sendReminder(deps, job('Alice'));
    expect(directs).toHaveLength(1);
    expect(directs[0]?.userId).toBe('U1');
    expect(directs[0]?.msg.fallbackText).toContain('10:00');
    expect((await getDelivery(db, reminderKey('alice')))?.status).toBe('sent');
  });

  test('config override wins over stored identity', async () => {
    const { deps, directs } = await setup(
      config('[alice, bob]', 'members:\n  Alice: { slack: U0CONF }'),
    );
    await identify('alice', 'U1');
    await sendReminder(deps, job('alice'));
    expect(directs[0]?.userId).toBe('U0CONF');
  });

  test('a person in two teams gets exactly one DM', async () => {
    const { deps, directs, setNow } = await setup(twoTeamsWithAlice());
    await identify('alice', 'U1');
    await runTick(deps);
    setNow(local('2026-10-28T09:30:00'));
    await runTick(deps);
    await sendReminder(deps, job('alice'));
    await sendReminder(deps, job('alice'));
    expect(directs).toHaveLength(1);
    expect(directs[0]?.msg.fallbackText).toContain('10:00');
  });

  test('submitting between enqueue and send produces no DM', async () => {
    const { deps, directs } = await setup();
    await identify('alice', 'U1');
    const alice = await seedMember();
    await upsertDaily(db, {
      installationId: INST,
      memberId: alice.id,
      date: DATE,
      payload: daily,
      submittedAt: new Date('2026-10-28T12:01:00Z'),
    });
    await sendReminder(deps, job('alice'));
    expect(directs).toEqual([]);
    expect(await getDelivery(db, reminderKey('alice'))).toBeNull();
  });

  test('no DM once every team of the person had its digest sent', async () => {
    const { deps, directs } = await setup(twoTeamsWithAlice());
    await identify('alice', 'U1');
    await markSent('Alpha');
    await markSent('Beta');
    await sendReminder(deps, job('alice'));
    expect(directs).toEqual([]);
  });

  test('still reminds while one of the teams has no digest yet', async () => {
    const { deps, directs } = await setup(twoTeamsWithAlice());
    await identify('alice', 'U1');
    await markSent('Alpha');
    await sendReminder(deps, job('alice'));
    expect(directs).toHaveLength(1);
  });

  test('no DM or claim once the digest instant has passed even if the digest is only claimed', async () => {
    const { deps, directs, setNow } = await setup();
    await identify('alice', 'U1');
    await claimDelivery(db, digestKey());
    setNow(new Date(local('2026-10-28T10:00:30')));
    await sendReminder(deps, job('alice'));
    expect(directs).toEqual([]);
    expect(await getDelivery(db, reminderKey('alice'))).toBeNull();
  });

  test('copy uses the digest time of the earliest pending eligible team', async () => {
    const { deps, directs, setNow } = await setup(twoTeamsWithAlice());
    await identify('alice', 'U1');
    await markSent('Alpha');
    setNow(local('2026-10-28T10:30:00'));
    await sendReminder(deps, job('alice'));
    expect(directs).toHaveLength(1);
    expect(directs[0]?.msg.fallbackText).toContain('11:00');
  });

  test('a team where the date is not a workday does not keep the reminder alive', async () => {
    const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice]
    chat: { provider: slack, channel: "#alpha" }
  - name: Beta
    timezone: America/Sao_Paulo
    workdays: [mon, thu, fri]
    remind_at: "09:30"
    digest_at: "11:00"
    managers: [alice]
    members: [alice]
    chat: { provider: slack, channel: "#beta" }
`);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const { deps, directs, setNow } = await setup(parsed.config);
    await identify('alice', 'U1');
    await markSent('Alpha');
    setNow(local('2026-10-28T10:30:00'));
    await sendReminder(deps, job('alice'));
    expect(directs).toEqual([]);
  });

  test('a reminder already sent or exhausted is not enqueued again by the tick', async () => {
    const fake = await setup();
    const key = reminderKey('alice');
    const claim = await claimDelivery(db, key);
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await completeDelivery(db, key, claim.token, { channel: 'D1', id: '1' });
    await runTick(fake.deps);
    expect(
      fake.queue.enqueued.filter((j) => j.name === 'send-reminder').map((j) => j.data),
    ).toEqual([{ installationId: INST, login: 'bob', date: DATE }]);
  });

  test('person outside every team is skipped', async () => {
    const { deps, directs } = await setup();
    await sendReminder(deps, job('carol'));
    expect(directs).toEqual([]);
  });

  test('missing chat identity fails the delivery without throwing and others proceed', async () => {
    const { deps, directs } = await setup();
    await identify('bob', 'U2');
    await sendReminder(deps, job('alice'));
    await sendReminder(deps, job('bob'));
    const failed = await getDelivery(db, reminderKey('alice'));
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toStartWith('no_chat_identity');
    expect(directs.map((d) => d.userId)).toEqual(['U2']);
  });

  test('a slack error fails the delivery and rethrows', async () => {
    const { deps, failWith, directs } = await setup();
    await identify('alice', 'U1');
    failWith(new ChatDeliveryError('rate_limited', 'slow down'));
    await expect(sendReminder(deps, job('alice'))).rejects.toThrow();
    expect(directs).toEqual([]);
    expect((await getDelivery(db, reminderKey('alice')))?.status).toBe('failed');
  });

  test('a user_not_found failure forgets the stored slack identity and records the failure', async () => {
    const { deps, failWith } = await setup();
    await identify('alice', 'U1');
    await identify('bob', 'U2');
    failWith(new ChatDeliveryError('user_not_found', 'gone'));
    await expect(sendReminder(deps, job('alice'))).rejects.toThrow();
    const failed = await getDelivery(db, reminderKey('alice'));
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toStartWith('user_not_found');
    expect(Object.fromEntries(await getIdentities(db, INST, 'slack'))).toEqual({ bob: 'U2' });
  });

  test('a user_not_found failure on an override identity deletes nothing', async () => {
    const { deps, failWith } = await setup(
      config('[alice, bob]', 'members:\n  alice:\n    slack: U0CONF\n'),
    );
    await identify('alice', 'U0CONF');
    failWith(new ChatDeliveryError('user_not_found', 'gone'));
    await expect(sendReminder(deps, job('alice'))).rejects.toThrow();
    expect((await getDelivery(db, reminderKey('alice')))?.status).toBe('failed');
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U0CONF');
  });

  test('a user_disabled failure forgets the stored slack identity', async () => {
    const { deps, failWith } = await setup();
    await identify('alice', 'U1');
    failWith(new ChatDeliveryError('user_disabled', 'disabled'));
    await expect(sendReminder(deps, job('alice'))).rejects.toThrow();
    expect((await getDelivery(db, reminderKey('alice')))?.error).toStartWith('user_disabled');
    expect((await getIdentities(db, INST, 'slack')).size).toBe(0);
  });

  test('an account_inactive failure is about the token and deletes nothing', async () => {
    const { deps, failWith } = await setup();
    await identify('alice', 'U1');
    failWith(new ChatDeliveryError('account_inactive', 'inactive'));
    await expect(sendReminder(deps, job('alice'))).rejects.toThrow();
    expect((await getDelivery(db, reminderKey('alice')))?.status).toBe('failed');
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U1');
  });

  test('other slack errors keep the stored identity', async () => {
    const { deps, failWith } = await setup();
    await identify('alice', 'U1');
    failWith(new ChatDeliveryError('channel_not_found', 'nope'));
    await expect(sendReminder(deps, job('alice'))).rejects.toThrow();
    expect((await getIdentities(db, INST, 'slack')).get('alice')).toBe('U1');
  });

  test('unconfigured installation is a no-op', async () => {
    const { deps, directs } = await setup();
    await setInstallationConfig(db, INST, { status: 'unconfigured', reason: 'no_repo' });
    await sendReminder(deps, job('alice'));
    expect(directs).toEqual([]);
  });
});
