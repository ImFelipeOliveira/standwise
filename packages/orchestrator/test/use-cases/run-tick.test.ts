import { describe, expect, spyOn, test } from 'bun:test';
import { parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  setInstallationConfig,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { runTick } from '../../src';
import { config, fakeDeps, INST, seedOrg } from './fakes';

useCleanDb();

const local = (iso: string) => new Date(`${iso}-03:00`);

const digestKey = (date: string, teamName = 'Alpha') => ({
  installationId: INST,
  teamName,
  date,
  kind: 'digest' as const,
});

function twoTeams(): StandwiseConfig {
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
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [bob]
    members: [bob]
    chat: { provider: slack, channel: "#beta" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

const digests = (f: { queue: { enqueued: { name: string; data: unknown }[] } }) =>
  f.queue.enqueued.filter((j) => j.name === 'send-digest');

async function tickAt(at: Date, cfg: StandwiseConfig = config()) {
  await seedOrg(cfg);
  const fake = fakeDeps();
  fake.setNow(at);
  await runTick(fake.deps);
  return fake;
}

describe('runTick', () => {
  test('tick enqueues once per due team', async () => {
    const early = await tickAt(local('2026-10-28T09:59:00'));
    expect(digests(early)).toEqual([]);

    const fake = await tickAt(local('2026-10-28T10:00:00'));
    await runTick(fake.deps);
    expect(digests(fake)).toEqual([
      {
        name: 'send-digest',
        data: { installationId: INST, teamName: 'Alpha', date: '2026-10-28' },
      },
    ]);
  });

  test('tick keeps the last valid config while standwise.yml is invalid', async () => {
    await seedOrg();
    await setInstallationConfig(db, INST, {
      status: 'invalid',
      errors: [{ path: 'teams', message: 'bad' }],
    });
    const fake = fakeDeps();
    fake.setNow(local('2026-10-28T10:00:00'));
    await runTick(fake.deps);
    expect(digests(fake)).toEqual([
      {
        name: 'send-digest',
        data: { installationId: INST, teamName: 'Alpha', date: '2026-10-28' },
      },
    ]);
  });

  test('tick catches up within grace', async () => {
    const fake = await tickAt(local('2026-10-28T11:30:00'));
    expect(digests(fake)).toHaveLength(1);
    const late = await tickAt(local('2026-10-28T12:01:00'));
    expect(digests(late)).toEqual([]);
  });

  test('tick skips non-workday', async () => {
    const fake = await tickAt(local('2026-10-31T10:00:00'));
    expect(digests(fake)).toEqual([]);
  });

  test('tick covers a digest whose grace crosses midnight', async () => {
    const base = config();
    const team = base.teams[0];
    if (!team) throw new Error('no team');
    const cfg = { ...base, teams: [{ ...team, digestAt: '23:30' }] };
    const fake = await tickAt(local('2026-10-29T00:15:00'), cfg);
    expect(digests(fake)).toEqual([
      {
        name: 'send-digest',
        data: { installationId: INST, teamName: 'Alpha', date: '2026-10-28' },
      },
    ]);
  });

  test('tick skips a digest already sent', async () => {
    await seedOrg();
    const claim = await claimDelivery(db, digestKey('2026-10-28'));
    if (claim.status !== 'claimed') throw new Error('not claimed');
    await completeDelivery(db, digestKey('2026-10-28'), claim.token, { channel: 'C1', id: '1' });
    const fake = await tickAt(local('2026-10-28T10:05:00'));
    expect(digests(fake)).toEqual([]);
  });

  test('tick retries a failed digest until attempts run out', async () => {
    await seedOrg();
    const key = digestKey('2026-10-28');
    const first = await claimDelivery(db, key);
    if (first.status !== 'claimed') throw new Error('not claimed');
    await failDelivery(db, key, first.token, 'not_in_channel: x');
    const retry = await tickAt(local('2026-10-28T10:05:00'));
    expect(digests(retry)).toHaveLength(1);

    for (let i = 0; i < 2; i++) {
      const claim = await claimDelivery(db, key);
      if (claim.status !== 'claimed') throw new Error('not claimed');
      await failDelivery(db, key, claim.token, 'not_in_channel: x');
    }
    const exhausted = await tickAt(local('2026-10-28T10:06:00'));
    expect(digests(exhausted)).toEqual([]);
  });

  test('removed team gets no digest', async () => {
    await seedOrg(twoTeams());
    const cfg = twoTeams();
    const fake = await tickAt(local('2026-10-28T10:00:00'), {
      ...cfg,
      teams: cfg.teams.filter((t) => t.name !== 'Beta'),
    });
    expect(digests(fake).map((j) => (j.data as { teamName: string }).teamName)).toEqual(['Alpha']);
  });

  test('tick uses the previous calendar day across a spring-forward', async () => {
    const base = config();
    const team = base.teams[0];
    if (!team) throw new Error('no team');
    const cfg = {
      ...base,
      teams: [
        {
          ...team,
          timezone: 'America/New_York',
          workdays: ['sun' as const],
          digestAt: '23:30',
        },
      ],
    };
    const fake = await tickAt(new Date('2026-03-09T00:30:00-04:00'), cfg);
    expect(digests(fake)).toEqual([
      {
        name: 'send-digest',
        data: { installationId: INST, teamName: 'Alpha', date: '2026-03-08' },
      },
    ]);
  });

  test('a failing reminder enqueue is logged without payload and does not break the tick', async () => {
    await seedOrg();
    const fake = fakeDeps();
    fake.setNow(local('2026-10-28T09:30:00'));
    let attempts = 0;
    fake.deps.github.resolveTeamMembers = async () => {
      attempts++;
      throw new Error('github down');
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await runTick(fake.deps);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(attempts).toBe(1);
    expect(logged).toContain('github down');
    expect(fake.queue.enqueued).toEqual([]);

    fake.setNow(local('2026-10-28T10:00:00'));
    await runTick(fake.deps);
    expect(digests(fake)).toHaveLength(1);
  });
});
