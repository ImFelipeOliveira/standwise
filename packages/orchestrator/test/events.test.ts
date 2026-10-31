import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  getDelivery,
  getWebhookDelivery,
  insertWebhookEndpoint,
  listDailies,
  setIdentity,
  setMemberInstallations,
  upsertDaily,
  type WebhookEventType,
} from '@standwise/db';
import { db, useCleanDb } from '../../db/test/setup';
import {
  createMembershipCheck,
  type Envelope,
  emitEvent,
  newBlockers,
  normalizeBlockerText,
  sendDigest,
  submitDaily,
} from '../src';
import { config, daily, fakeChat, fakeDeps, INST, seedMember, seedOrg } from './use-cases/fakes';

useCleanDb();

const KEY = new Uint8Array(32).fill(7);
const OTHER = 22;

afterEach(() => {
  mock.restore();
});

async function endpoint(
  installationId = INST,
  events: WebhookEventType[] = ['daily.submitted', 'blocker.opened', 'digest.sent'],
  url = 'https://hooks.example.com/standwise',
) {
  const { id } = await insertWebhookEndpoint(
    db,
    { installationId, url, events, secret: 'whsec_x' },
    KEY,
  );
  return id;
}

async function emitted(queue: ReturnType<typeof fakeDeps>['queue']) {
  const rows = [];
  for (const job of queue.enqueued.filter((j) => j.name === 'deliver-webhook')) {
    const row = await getWebhookDelivery(db, (job.data as { deliveryId: string }).deliveryId);
    if (row) rows.push(row);
  }
  return rows;
}

const envelopeOf = (row: { payload: unknown }) => row.payload as Envelope;

async function setup() {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

describe('blocker text', () => {
  test('normalizes case and whitespace', () => {
    expect(normalizeBlockerText('  Waiting   for\tthe DB  ')).toBe('waiting for the db');
  });

  test('new blockers are compared by normalized text, once each', () => {
    const before = [{ text: 'Waiting for DB' }];
    const after = [
      { text: 'waiting  for db' },
      { text: 'Need access' },
      { text: 'need ACCESS ' },
      { text: 'Flaky CI' },
    ];
    expect(newBlockers(before, after).map((b) => b.text)).toEqual(['Need access', 'Flaky CI']);
    expect(newBlockers(undefined, after.slice(0, 1)).map((b) => b.text)).toEqual([
      'waiting  for db',
    ]);
  });
});

describe('emitEvent', () => {
  test('creates one delivery per active subscribed endpoint and enqueues it', async () => {
    await seedOrg();
    const all = await endpoint();
    const digestOnly = await endpoint(INST, ['digest.sent']);
    const fake = fakeDeps();
    await emitEvent(fake.deps, INST, {
      type: 'daily.submitted',
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        login: 'Alice',
        date: '2026-10-28',
        teams: ['Alpha'],
        yesterday: [],
        today: [{ text: 'x' }],
        blockers: [],
        replaced: false,
      },
    });
    const rows = await emitted(fake.queue);
    expect(rows.map((r) => r.endpointId)).toEqual([all]);
    expect(rows.map((r) => r.endpointId)).not.toContain(digestOnly);
    const [row] = rows;
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
    expect(row?.event).toBe('daily.submitted');
    const envelope = envelopeOf(row as { payload: unknown });
    expect(envelope).toEqual({
      id: row?.eventId as string,
      type: 'daily.submitted',
      created_at: '2026-10-28T15:00:00.000Z',
      installation: { id: INST, login: 'acme' },
      data: expect.objectContaining({ login: 'Alice', replaced: false }),
    });
  });

  test('no duplicate per event', async () => {
    await seedOrg();
    const a = await endpoint();
    const b = await endpoint(INST, ['digest.sent']);
    const fake = fakeDeps();
    const event = {
      type: 'digest.sent' as const,
      data: { team: 'Alpha', date: '2026-10-28', submitted: [], missing: ['bob'] },
    };
    const id = '11111111-1111-4111-8111-111111111111';
    await emitEvent(fake.deps, INST, event, { id });
    await emitEvent(fake.deps, INST, event, { id });
    const rows = await emitted(fake.queue);
    expect(rows.map((r) => r.endpointId).sort()).toEqual([a, b].sort());
    expect(rows.every((r) => r.eventId === id)).toBe(true);
  });

  test('tenant isolation', async () => {
    await seedOrg();
    await seedOrg(config(), { id: OTHER, accountLogin: 'globex' });
    const mine = await endpoint(INST);
    const theirs = await endpoint(OTHER);
    const fake = fakeDeps();
    await emitEvent(fake.deps, OTHER, {
      type: 'digest.sent',
      data: { team: 'Alpha', date: '2026-10-28', submitted: [], missing: [] },
    });
    const rows = await emitted(fake.queue);
    expect(rows.map((r) => r.endpointId)).toEqual([theirs]);
    expect(rows.map((r) => r.endpointId)).not.toContain(mine);
    expect(envelopeOf(rows[0] as { payload: unknown }).installation).toEqual({
      id: OTHER,
      login: 'globex',
    });
  });

  test('without subscribed endpoints nothing is enqueued', async () => {
    await seedOrg();
    await endpoint(INST, ['digest.sent']);
    const fake = fakeDeps();
    await emitEvent(fake.deps, INST, {
      type: 'blocker.opened',
      data: { dailyId: 'x', login: 'a', date: '2026-10-28', text: 'b', teams: [] },
    });
    expect(fake.queue.enqueued).toEqual([]);
  });
});

describe('events emitted', () => {
  test('a daily with a blocker emits daily.submitted and blocker.opened', async () => {
    const { deps, isMember, member, queue } = await setup();
    await endpoint();
    const ref = { kind: 'issue' as const, url: 'https://github.com/acme/api/issues/9' };
    await submitDaily(deps, isMember, member, {
      ...daily,
      blockers: [{ text: 'Waiting for the DB', ref }],
    });
    const [stored] = await listDailies(db, INST, '2026-10-28');
    const rows = await emitted(queue);
    expect(rows.map((r) => r.event)).toEqual(['daily.submitted', 'blocker.opened']);
    const submitted = envelopeOf(rows[0] as { payload: unknown });
    expect(submitted.data).toEqual({
      id: expect.any(String),
      login: 'Alice',
      date: '2026-10-28',
      teams: ['Alpha'],
      yesterday: daily.yesterday,
      today: daily.today,
      blockers: [{ text: 'Waiting for the DB', ref }],
      replaced: false,
    });
    const opened = envelopeOf(rows[1] as { payload: unknown });
    expect(opened.data).toEqual({
      dailyId: (submitted.data as { id: string }).id,
      login: 'Alice',
      date: '2026-10-28',
      text: 'Waiting for the DB',
      ref,
      teams: ['Alpha'],
    });
    expect(stored?.memberId).toBe(member.id);
  });

  test('resubmitting with the same blocker emits only daily.submitted with replaced', async () => {
    const { deps, isMember, member, queue } = await setup();
    await endpoint();
    await submitDaily(deps, isMember, member, { ...daily, blockers: [{ text: 'Waiting for DB' }] });
    queue.enqueued.length = 0;
    await submitDaily(deps, isMember, member, {
      ...daily,
      blockers: [{ text: '  waiting for  db ' }],
    });
    const rows = await emitted(queue);
    expect(rows.map((r) => r.event)).toEqual(['daily.submitted']);
    expect(envelopeOf(rows[0] as { payload: unknown }).data).toMatchObject({ replaced: true });
    queue.enqueued.length = 0;
    await submitDaily(deps, isMember, member, {
      ...daily,
      blockers: [{ text: 'waiting for db' }, { text: 'Flaky CI' }],
    });
    const third = await emitted(queue);
    expect(third.map((r) => r.event)).toEqual(['daily.submitted', 'blocker.opened']);
    expect(envelopeOf(third[1] as { payload: unknown }).data).toMatchObject({ text: 'Flaky CI' });
  });

  test('rewording a blocker with the same ref still emits blocker.opened', async () => {
    const { deps, isMember, member, queue } = await setup();
    await endpoint();
    const ref = { kind: 'pull_request' as const, url: 'https://github.com/acme/api/pull/7' };
    await submitDaily(deps, isMember, member, { ...daily, blockers: [{ text: 'Waiting', ref }] });
    queue.enqueued.length = 0;
    await submitDaily(deps, isMember, member, {
      ...daily,
      blockers: [{ text: 'Still waiting for review', ref }],
    });
    const rows = await emitted(queue);
    expect(rows.map((r) => r.event)).toEqual(['daily.submitted', 'blocker.opened']);
    expect(queue.enqueued.filter((j) => j.name === 'route-blocker')).toEqual([]);
  });

  test('sendDigest emits digest.sent once', async () => {
    await seedOrg();
    const alice = await seedMember();
    await setIdentity(db, INST, alice.id, 'slack', 'UALICE');
    await upsertDaily(db, {
      installationId: INST,
      memberId: alice.id,
      date: '2026-10-28',
      payload: daily,
      submittedAt: new Date('2026-10-28T12:00:00Z'),
    });
    await endpoint();
    const fake = fakeDeps();
    const chat = fakeChat();
    fake.deps.chatFor = async () => chat.chat;
    const job = { installationId: INST, teamName: 'Alpha', date: '2026-10-28' };
    await sendDigest(fake.deps, job);
    await sendDigest(fake.deps, job);
    const rows = await emitted(fake.queue);
    expect(rows.map((r) => r.event)).toEqual(['digest.sent']);
    expect(envelopeOf(rows[0] as { payload: unknown }).data).toEqual({
      team: 'Alpha',
      date: '2026-10-28',
      submitted: ['Alice'],
      missing: ['bob'],
    });
  });

  test('a failing emission never breaks the daily or the digest', async () => {
    const { deps, isMember, member, queue } = await setup();
    await endpoint();
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    queue.enqueue = async () => {
      throw new Error('queue down');
    };
    const result = await submitDaily(deps, isMember, member, {
      ...daily,
      blockers: [{ text: 'b' }],
    });
    expect(result.date).toBe('2026-10-28');
    expect(await listDailies(db, INST, '2026-10-28')).toHaveLength(1);

    await setIdentity(db, INST, member.id, 'slack', 'UALICE');
    const chat = fakeChat();
    deps.chatFor = async () => chat.chat;
    await sendDigest(deps, { installationId: INST, teamName: 'Alpha', date: '2026-10-28' });
    expect(chat.posted).toHaveLength(1);
    const delivery = await getDelivery(db, {
      installationId: INST,
      teamName: 'Alpha',
      date: '2026-10-28',
      kind: 'digest',
    });
    expect(delivery?.status).toBe('sent');
    expect(errors).toHaveBeenCalled();
  });
});
