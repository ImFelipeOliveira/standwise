import { describe, expect, test } from 'bun:test';
import {
  decideSuggestion,
  setMemberInstallations,
  syncSuggestions,
  upsertDaily,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, getDraft } from '../../src';
import { config, daily, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup(cfg = config()) {
  await seedOrg(cfg);
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

  test('renamed member lists activity with the new login on the first request', async () => {
    const { deps, isMember, member, calls, users, orgMembers } = await setup(
      config('[alice-new, bob]'),
    );
    users.set(1, 'alice-new');
    orgMembers.add('alice-new');
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.teams).toEqual(['Alpha']);
    expect(calls.activityLogins).toEqual(['alice-new']);
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

  test('lists only the pending suggestions of the member', async () => {
    const { deps, isMember, member } = await setup();
    const bob = await seedMember('bob', 2);
    const signal = (n: number, kind: 'pr_no_review' | 'ci_failing') => ({
      kind,
      ref: { kind: 'pull_request' as const, url: `https://github.com/acme/api/pull/${n}` },
      fingerprint: `fp-${n}`,
      since: new Date('2026-10-26T00:00:00Z'),
    });
    const { created } = await syncSuggestions(
      db,
      INST,
      member.id,
      [],
      [signal(1, 'pr_no_review'), signal(2, 'ci_failing'), signal(3, 'ci_failing')],
    );
    await syncSuggestions(db, INST, bob.id, [], [signal(4, 'pr_no_review')]);
    const byFp = (fp: string) => {
      const row = created.find((c) => c.fingerprint === fp);
      if (!row) throw new Error('seed failed');
      return row;
    };
    await decideSuggestion(db, INST, member.id, byFp('fp-2').id, 'ignored');
    await decideSuggestion(db, INST, member.id, byFp('fp-3').id, 'confirmed');
    const draft = await getDraft(deps, isMember, member, 'acme');
    expect(draft.suggestions).toEqual([
      {
        id: byFp('fp-1').id,
        kind: 'pr_no_review',
        ref: { kind: 'pull_request', url: 'https://github.com/acme/api/pull/1' },
        since: byFp('fp-1').createdAt.toISOString(),
      },
    ]);
  });
});
