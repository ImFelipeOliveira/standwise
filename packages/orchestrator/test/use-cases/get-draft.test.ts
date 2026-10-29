import { describe, expect, test } from 'bun:test';
import { setMemberInstallations, upsertDaily } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, getDraft } from '../../src';
import { daily, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup() {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

describe('getDraft', () => {
  test('since window starts at the previous workday', async () => {
    const { deps, isMember, member, calls } = await setup();
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft).toEqual({
      org: 'acme',
      date: '2026-10-28',
      since: '2026-10-27T03:00:00.000Z',
      teams: ['Alpha'],
      activity: [],
      suggestions: [],
    });
    expect(calls.activity[0]?.toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });

  test('since window starts at the last daily submitted on the previous workday', async () => {
    const { deps, isMember, member } = await setup();
    const submittedAt = new Date('2026-10-27T20:00:00Z');
    await upsertDaily(db, {
      installationId: INST,
      memberId: member.id,
      date: '2026-10-27',
      payload: daily,
      submittedAt,
    });
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.since).toBe(submittedAt.toISOString());
  });
});
