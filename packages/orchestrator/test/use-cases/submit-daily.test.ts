import { describe, expect, test } from 'bun:test';
import {
  claimDelivery,
  completeDelivery,
  listDailies,
  setMemberInstallations,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, submitDaily } from '../../src';
import { daily, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup() {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

describe('submitDaily', () => {
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
