import { describe, expect, spyOn, test } from 'bun:test';
import { parseConfig, type StandcastConfig } from '@standcast/core';
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  markDeliverySent,
  setInstallationConfig,
  setMemberInstallations,
} from '@standcast/db';
import type { EnqueueOptions } from '@standcast/queue';
import { db, useCleanDb } from '../../../db/test/setup';
import { runTick, scanOffsetSeconds } from '../../src';
import { config, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const local = (iso: string) => new Date(`${iso}-03:00`);

const digestKey = (date: string, teamName = 'Alpha') => ({
  installationId: INST,
  teamName,
  date,
  kind: 'digest' as const,
});

function twoTeams(): StandcastConfig {
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

async function tickAt(at: Date, cfg: StandcastConfig = config()) {
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

  test('tick keeps the last valid config while standcast.yml is invalid', async () => {
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

  describe('signal scans', () => {
    const scans = (f: { queue: { enqueued: { name: string; data: unknown }[] } }) =>
      f.queue.enqueued.filter((j) => j.name === 'scan-member-signals').map((j) => j.data);

    async function linkAlice() {
      const alice = await seedMember('Alice', 1);
      await setMemberInstallations(db, alice.id, [INST]);
    }

    function remindingAt(remindAt: string): StandcastConfig {
      const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "${remindAt}"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#alpha" }
`);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      return parsed.config;
    }

    test('the tick enqueues a scan at remind_at minus 60 minutes for linked members', async () => {
      await seedOrg();
      await linkAlice();
      const fake = fakeDeps();
      fake.setNow(local('2026-10-28T07:59:00'));
      await runTick(fake.deps);
      expect(scans(fake)).toEqual([]);

      fake.setNow(local('2026-10-28T08:00:00'));
      await runTick(fake.deps);
      expect(scans(fake)).toEqual([{ installationId: INST, login: 'alice', date: '2026-10-28' }]);
    });

    test('tick scans are spread over 30 minutes by a deterministic offset per login', async () => {
      await seedOrg(remindingAt('09:00'));
      await linkAlice();
      const bob = await seedMember('Bob', 2);
      await setMemberInstallations(db, bob.id, [INST]);
      const capture = async () => {
        const fake = fakeDeps();
        const seen: { login: string; opts?: EnqueueOptions }[] = [];
        const enqueue = fake.queue.enqueue.bind(fake.queue);
        fake.deps.queue = {
          ...fake.queue,
          enqueue: async (name, data, opts) => {
            if (name === 'scan-member-signals') {
              seen.push({ login: (data as { login: string }).login, opts });
            }
            return enqueue(name, data, opts);
          },
        };
        fake.setNow(local('2026-10-28T08:05:00'));
        await runTick(fake.deps);
        return seen;
      };
      const first = await capture();
      const second = await capture();
      expect(first.map((s) => s.login).sort()).toEqual(['alice', 'bob']);
      expect(second).toEqual(first);
      const windowStart = local('2026-10-28T08:00:00').getTime();
      for (const { login, opts } of first) {
        expect(opts?.singletonKey).toBe(`scan:${INST}:${login}`);
        expect(opts?.policy).toBe('stately');
        expect(opts?.startAfter?.getTime()).toBe(windowStart + scanOffsetSeconds(login) * 1000);
      }
      for (const login of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace']) {
        const offset = scanOffsetSeconds(login);
        expect(offset).toBe(scanOffsetSeconds(login.toUpperCase()));
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(30 * 60);
      }
      expect(
        new Set(['alice', 'bob', 'carol', 'dave'].map(scanOffsetSeconds)).size,
      ).toBeGreaterThan(1);
    });

    test('a day already scanned is not enqueued again', async () => {
      await seedOrg();
      await linkAlice();
      await markDeliverySent(db, {
        installationId: INST,
        teamName: '',
        date: '2026-10-28',
        kind: 'signal_scan',
        subject: 'alice',
      });
      const fake = fakeDeps();
      fake.setNow(local('2026-10-28T08:10:00'));
      await runTick(fake.deps);
      expect(scans(fake)).toEqual([]);
    });

    test('the scan window closes 60 minutes after it opens', async () => {
      await seedOrg();
      await linkAlice();
      const fake = fakeDeps();
      fake.setNow(local('2026-10-28T09:01:00'));
      await runTick(fake.deps);
      expect(scans(fake)).toEqual([]);
    });

    test('a remind_at before 01:00 scans at 00:00', async () => {
      await seedOrg(remindingAt('00:30'));
      await linkAlice();
      const fake = fakeDeps();
      fake.setNow(local('2026-10-27T23:59:00'));
      await runTick(fake.deps);
      expect(scans(fake)).toEqual([]);
      fake.setNow(local('2026-10-28T00:00:00'));
      await runTick(fake.deps);
      expect(scans(fake)).toEqual([{ installationId: INST, login: 'alice', date: '2026-10-28' }]);
    });

    test('a failing scan enqueue is logged and does not block reminders or the digest', async () => {
      await seedOrg();
      await linkAlice();
      const fake = fakeDeps();
      const enqueue = fake.queue.enqueue.bind(fake.queue);
      fake.deps.queue = {
        ...fake.queue,
        enqueue: async (name, data, opts) => {
          if (name === 'scan-member-signals') throw new Error('queue down');
          return enqueue(name, data, opts);
        },
      };
      fake.setNow(local('2026-10-28T09:00:00'));
      const spy = spyOn(console, 'error').mockImplementation(() => {});
      await runTick(fake.deps);
      const logged = JSON.stringify(spy.mock.calls);
      spy.mockRestore();
      expect(logged).toContain('queue down');
      expect(fake.queue.enqueued.map((j) => j.name)).toContain('send-reminder');
    });
  });
});
