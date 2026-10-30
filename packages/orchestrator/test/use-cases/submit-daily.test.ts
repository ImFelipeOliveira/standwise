import { describe, expect, spyOn, test } from 'bun:test';
import {
  claimDelivery,
  completeDelivery,
  getMemberDaily,
  listDailies,
  setMemberInstallations,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  blockerHash,
  createMembershipCheck,
  getToday,
  listOrgDailies,
  submitDaily,
} from '../../src';
import { config, daily, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup(cfg = config()) {
  await seedOrg(cfg);
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

describe('submitDaily', () => {
  test('stores how the daily was confirmed without exposing it in organization reads', async () => {
    const { deps, isMember, member } = await setup();
    await submitDaily(deps, isMember, member, daily, { confirmation: 'agent' });
    const [row] = await listDailies(db, INST, '2026-10-28');
    expect(row?.payload).toEqual({ ...daily, confirmation: 'agent' });
    const page = await listOrgDailies(deps, INST, {});
    expect(page.data[0]).not.toHaveProperty('confirmation');
    await submitDaily(deps, isMember, member, daily);
    const [plain] = await listDailies(db, INST, '2026-10-28');
    expect(plain?.payload).toEqual(daily);
  });

  test('getToday returns the standup date without fetching activity', async () => {
    const { deps, isMember, member, calls, setNow } = await setup();
    setNow(new Date('2026-10-31T15:00:00Z'));
    expect(await getToday(deps, isMember, member, 'ACME')).toEqual({
      org: 'acme',
      date: '2026-11-02',
      teams: ['Alpha'],
    });
    expect(calls.activity).toEqual([]);
  });

  test('replaces the daily of the same day', async () => {
    const { deps, isMember, member, queue } = await setup();
    const first = await submitDaily(deps, isMember, member, daily);
    expect(first).toEqual({ date: '2026-10-28', teams: ['Alpha'], late: false });
    await submitDaily(deps, isMember, member, { ...daily, today: [{ text: 'changed' }] });
    const rows = await listDailies(db, INST, '2026-10-28');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.today[0]?.text).toBe('changed');
    expect(queue.enqueued).toHaveLength(0);
  });

  test('renamed member submits with the new login on the first request', async () => {
    const { deps, isMember, member, users, orgMembers } = await setup(config('[alice-new, bob]'));
    users.set(1, 'alice-new');
    orgMembers.add('alice-new');
    const result = await submitDaily(deps, isMember, member, daily);
    expect(result.teams).toEqual(['Alpha']);
    const rows = await listDailies(db, INST, '2026-10-28');
    expect(rows.map((r) => r.memberId)).toEqual([member.id]);
  });

  test('after the digest is sent the daily is late and enqueued', async () => {
    const { deps, isMember, member, queue } = await setup();
    const key = {
      installationId: INST,
      teamName: 'Alpha',
      date: '2026-10-28',
      kind: 'digest' as const,
    };
    const claim = await claimDelivery(db, key);
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await completeDelivery(db, key, claim.token, { channel: 'C1', id: '1.1' });
    const result = await submitDaily(deps, isMember, member, daily);
    expect(result.late).toBe(true);
    expect(queue.enqueued).toEqual([
      {
        name: 'send-late-daily',
        data: { installationId: INST, memberId: member.id, date: '2026-10-28' },
      },
    ]);
  });

  test('enqueues one route-blocker job per new blocker only', async () => {
    const { deps, isMember, member, queue } = await setup();
    const blocker = { text: 'Need prod access' };
    const first = { ...daily, blockers: [blocker] };
    await submitDaily(deps, isMember, member, first);
    await submitDaily(deps, isMember, member, {
      ...daily,
      blockers: [{ text: '  need PROD access ' }, { text: 'Flaky CI' }],
    });
    const row = await getMemberDaily(db, INST, member.id, '2026-10-28');
    const routes = queue.enqueued.filter((j) => j.name === 'route-blocker');
    expect(routes).toEqual([
      {
        name: 'route-blocker',
        data: {
          installationId: INST,
          dailyId: row?.id,
          blockerIndex: 0,
          blockerHash: blockerHash(blocker),
        },
      },
      {
        name: 'route-blocker',
        data: {
          installationId: INST,
          dailyId: row?.id,
          blockerIndex: 1,
          blockerHash: blockerHash({ text: 'Flaky CI' }),
        },
      },
    ]);
    expect(blockerHash({ text: '  need PROD access ' })).toBe(blockerHash(blocker));
  });

  test('a failing enqueue does not fail the submit and does not log the payload', async () => {
    const { deps, isMember, member } = await setup();
    deps.queue.enqueue = async () => {
      throw Object.assign(new Error('queue down'), { code: 'ECONNREFUSED' });
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await submitDaily(deps, isMember, member, {
        ...daily,
        blockers: [{ text: 'Very private blocker' }],
      });
      expect(result.date).toBe('2026-10-28');
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('queue down');
      expect(logged).not.toContain('Very private blocker');
    } finally {
      spy.mockRestore();
    }
  });
});
