import { describe, expect, test } from 'bun:test';
import {
  claimDelivery,
  completeDelivery,
  listDailies,
  setMemberInstallations,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, getToday, listOrgDailies, submitDaily } from '../../src';
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
});
