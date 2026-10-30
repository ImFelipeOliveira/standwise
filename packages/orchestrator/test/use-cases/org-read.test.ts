import { beforeEach, describe, expect, test } from 'bun:test';
import { addCalendarDays, parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  type MemberRow,
  upsertDaily,
  upsertMember,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  DomainError,
  decodeCursor,
  encodeCursor,
  getOrgDaily,
  listOrgBlockers,
  listOrgDailies,
  listOrgDigests,
  listOrgTeams,
  loadInstallationConfig,
} from '../../src';
import { fakeDeps, INST, seedOrg } from './fakes';

useCleanDb();

const OTHER = 22;

function twoTeams(): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [Alice, bob]
    chat: { provider: slack, channel: "#alpha" }
  - name: Beta
    timezone: Europe/Lisbon
    workdays: [mon, tue, wed, thu]
    remind_at: "09:30"
    digest_at: "10:30"
    managers: [carol]
    members: [bob, carol, dave]
    chat: { provider: slack, channel: "#beta" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof DomainError ? error.code : undefined;
}

const people: Record<string, MemberRow> = {};

beforeEach(async () => {
  for (const [i, login] of ['Alice', 'bob', 'carol', 'dave', 'erin', 'frank'].entries()) {
    people[login] = await upsertMember(db, { githubUserId: i + 1, login, email: null });
  }
});

const who = (login: string) => {
  const member = people[login];
  if (!member) throw new Error(login);
  return member;
};

type Items = { text: string; ref?: { kind: 'pull_request'; url: string; title?: string } }[];

async function submit(
  login: string,
  date: string,
  overrides: { installationId?: number; blockers?: Items; today?: Items; yesterday?: Items } = {},
) {
  const member = who(login);
  await upsertDaily(db, {
    installationId: overrides.installationId ?? INST,
    memberId: member.id,
    date,
    payload: {
      org: 'acme',
      yesterday: overrides.yesterday ?? [{ text: `y ${login}` }],
      today: overrides.today ?? [{ text: `t ${login}` }],
      blockers: overrides.blockers ?? [],
    },
    submittedAt: new Date(`${date}T12:00:00Z`),
  });
}

describe('listOrgTeams', () => {
  test('returns the configured teams without any person data other than member logins', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    expect(await listOrgTeams(deps, INST)).toEqual([
      {
        name: 'Alpha',
        timezone: 'America/Sao_Paulo',
        workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        remindAt: '09:00',
        digestAt: '10:00',
        memberLogins: ['alice', 'bob'],
      },
      {
        name: 'Beta',
        timezone: 'Europe/Lisbon',
        workdays: ['mon', 'tue', 'wed', 'thu'],
        remindAt: '09:30',
        digestAt: '10:30',
        memberLogins: ['bob', 'carol', 'dave'],
      },
    ]);
  });

  test('an unconfigured installation is org_not_configured and an unknown one org_not_found', async () => {
    await seedOrg(null);
    const { deps } = fakeDeps();
    expect(await codeOf(listOrgTeams(deps, INST))).toBe('org_not_configured');
    expect(await codeOf(listOrgTeams(deps, 999))).toBe('org_not_found');
  });
});

describe('listOrgDailies', () => {
  test('builds each daily from the stored payload with teams from the current config', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('bob', '2026-10-27', {
      yesterday: [
        { text: 'shipped', ref: { kind: 'pull_request', url: 'https://github.com/a/b/pull/1' } },
      ],
      blockers: [{ text: 'waiting on infra' }],
    });
    const page = await listOrgDailies(deps, INST, {});
    expect(page.nextCursor).toBeNull();
    expect(page.data).toHaveLength(1);
    const [daily] = page.data;
    expect(daily).toEqual({
      id: expect.any(String),
      login: 'bob',
      date: '2026-10-27',
      submittedAt: new Date('2026-10-27T12:00:00Z'),
      teams: ['Alpha', 'Beta'],
      yesterday: [
        {
          text: 'shipped',
          ref: { kind: 'pull_request', url: 'https://github.com/a/b/pull/1', title: null },
        },
      ],
      today: [{ text: 't bob', ref: null }],
      blockers: [{ text: 'waiting on infra', ref: null }],
    });
  });

  test('filters by date and team', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-27');
    await submit('Alice', '2026-10-28');
    await submit('carol', '2026-10-28');
    await submit('erin', '2026-10-28');
    const logins = async (q: Parameters<typeof listOrgDailies>[2]) =>
      (await listOrgDailies(deps, INST, q)).data.map((d) => d.login).sort();
    expect(await logins({ date: '2026-10-28' })).toEqual(['Alice', 'carol', 'erin']);
    expect(await logins({ team: 'Alpha' })).toEqual(['Alice', 'Alice']);
    expect(await logins({ team: 'Beta', date: '2026-10-28' })).toEqual(['carol']);
    expect(await logins({ team: 'Beta', date: '2026-10-01' })).toEqual([]);
    const erin = (await listOrgDailies(deps, INST, { date: '2026-10-28' })).data.find(
      (d) => d.login === 'erin',
    );
    expect(erin?.teams).toEqual([]);
  });

  test('pages 120 dailies in three pages without repeats or gaps', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    const logins = ['Alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
    for (let d = 0; d < 20; d++) {
      const date = addCalendarDays('2026-09-01', d);
      for (const login of logins) await submit(login, date);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    do {
      const page = await listOrgDailies(deps, INST, { limit: 50, cursor });
      sizes.push(page.data.length);
      seen.push(...page.data.map((x) => x.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    const ordered = (await listOrgDailies(deps, INST, { limit: 100 })).data;
    expect(ordered.map((x) => x.date)).toEqual([...ordered.map((x) => x.date)].sort().reverse());
    expect(seen.slice(0, 100)).toEqual(ordered.map((x) => x.id));
  });

  test('an exact multiple of the limit ends with a null cursor', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-27');
    await submit('bob', '2026-10-27');
    const page = await listOrgDailies(deps, INST, { limit: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test('rejects malformed cursors, limits, dates and unknown teams', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    const bad = [
      { cursor: 'not-a-cursor' },
      { cursor: Buffer.from('{"date":"x","id":"y"}').toString('base64url') },
      { cursor: Buffer.from('[1]').toString('base64url') },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { date: '28/10/2026' },
      { date: '2026-13-45' },
      { team: 'Gamma' },
    ];
    for (const q of bad)
      expect(await codeOf(listOrgDailies(deps, INST, q))).toBe('invalid_request');
  });

  test('tenant isolation: other installations are never visible, even by team name', async () => {
    await seedOrg(twoTeams());
    await seedOrg(
      (() => {
        const parsed = parseConfig(`
teams:
  - name: Gamma
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#g" }
`);
        if (!parsed.ok) throw new Error('config');
        return parsed.config;
      })(),
      { id: OTHER, accountLogin: 'globex' },
    );
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-28');
    await submit('Alice', '2026-10-28', {
      installationId: OTHER,
      blockers: [{ text: 'secret blocker' }],
    });
    const mine = await listOrgDailies(deps, INST, {});
    expect(mine.data).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('secret blocker');
    expect(await codeOf(listOrgDailies(deps, INST, { team: 'Gamma' }))).toBe('invalid_request');
    const theirs = await listOrgDailies(deps, OTHER, {});
    expect(theirs.data).toHaveLength(1);
    expect(theirs.data[0]?.id).not.toBe(mine.data[0]?.id);
    const foreignId = theirs.data[0]?.id ?? '';
    expect(await codeOf(getOrgDaily(deps, INST, foreignId))).toBe('not_found');
    expect((await getOrgDaily(deps, OTHER, foreignId)).id).toBe(foreignId);
  });

  test('responses carry only the documented keys', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-28');
    const page = await listOrgDailies(deps, INST, {});
    expect(Object.keys(page).sort()).toEqual(['data', 'nextCursor']);
    expect(Object.keys(page.data[0] ?? {}).sort()).toEqual([
      'blockers',
      'date',
      'id',
      'login',
      'submittedAt',
      'teams',
      'today',
      'yesterday',
    ]);
  });
});

describe('getOrgDaily', () => {
  test('returns one daily and not_found for unknown ids', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-28');
    const [first] = (await listOrgDailies(deps, INST, {})).data;
    expect(await getOrgDaily(deps, INST, first?.id ?? '')).toEqual(first as never);
    expect(await codeOf(getOrgDaily(deps, INST, crypto.randomUUID()))).toBe('not_found');
    expect(await codeOf(getOrgDaily(deps, INST, 'not-a-uuid'))).toBe('not_found');
  });
});

describe('listOrgBlockers', () => {
  test('lists the blockers of submitted dailies with author, date and teams', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('bob', '2026-10-27', {
      blockers: [
        { text: 'infra', ref: { kind: 'pull_request', url: 'https://github.com/a/b/pull/9' } },
        { text: 'review' },
      ],
    });
    await submit('Alice', '2026-10-28', { blockers: [{ text: 'access' }] });
    await submit('carol', '2026-10-28');
    const page = await listOrgBlockers(deps, INST, {});
    expect(page.nextCursor).toBeNull();
    expect(page.data).toEqual([
      { text: 'access', ref: null, author: 'Alice', date: '2026-10-28', teams: ['Alpha'] },
      {
        text: 'infra',
        ref: { kind: 'pull_request', url: 'https://github.com/a/b/pull/9', title: null },
        author: 'bob',
        date: '2026-10-27',
        teams: ['Alpha', 'Beta'],
      },
      { text: 'review', ref: null, author: 'bob', date: '2026-10-27', teams: ['Alpha', 'Beta'] },
    ]);
  });

  test('filters by date and team', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-28', { blockers: [{ text: 'a' }] });
    await submit('carol', '2026-10-28', { blockers: [{ text: 'c' }] });
    await submit('carol', '2026-10-27', { blockers: [{ text: 'c0' }] });
    const texts = async (q: Parameters<typeof listOrgBlockers>[2]) =>
      (await listOrgBlockers(deps, INST, q)).data.map((b) => b.text).sort();
    expect(await texts({ team: 'Beta' })).toEqual(['c', 'c0']);
    expect(await texts({ date: '2026-10-28' })).toEqual(['a', 'c']);
    expect(await texts({ team: 'Alpha', date: '2026-10-27' })).toEqual([]);
    expect(await codeOf(listOrgBlockers(deps, INST, { team: 'Nope' }))).toBe('invalid_request');
  });

  test('pages blockers across and within dailies without repeats or gaps', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    const all: string[] = [];
    for (const [i, login] of ['Alice', 'bob', 'carol', 'dave', 'erin'].entries()) {
      const count = (i % 3) + 1;
      const blockers = Array.from({ length: count }, (_, n) => ({ text: `${login}-${n}` }));
      await submit(login, '2026-10-28', { blockers });
      all.push(...blockers.map((b) => b.text));
    }
    for (const limit of [1, 2, 3, 5, 100]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await listOrgBlockers(deps, INST, { limit, cursor });
        expect(page.data.length).toBeGreaterThan(0);
        expect(page.data.length).toBeLessThanOrEqual(limit);
        seen.push(...page.data.map((b) => b.text));
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);
      expect([...seen].sort()).toEqual([...all].sort());
      expect(pages).toBe(Math.ceil(all.length / limit));
    }
  });

  test('tenant isolation', async () => {
    await seedOrg(twoTeams());
    await seedOrg(twoTeams(), { id: OTHER, accountLogin: 'globex' });
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-28', { installationId: OTHER, blockers: [{ text: 'theirs' }] });
    expect((await listOrgBlockers(deps, INST, {})).data).toEqual([]);
  });
});

describe('listOrgDigests', () => {
  async function digest(
    team: string,
    date: string,
    outcome: 'sent' | 'failed' | 'pending',
    installationId = INST,
  ) {
    const key = { installationId, teamName: team, date, kind: 'digest' as const };
    const claim = await claimDelivery(db, key);
    if (claim.status !== 'claimed') throw new Error('claim');
    if (outcome === 'sent') await completeDelivery(db, key, claim.token, { channel: 'C', id: '1' });
    if (outcome === 'failed') await failDelivery(db, key, claim.token, 'slack_down');
  }

  test('lists digest deliveries with status, sentAt and who is missing', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await submit('Alice', '2026-10-28');
    await submit('carol', '2026-10-28');
    await digest('Alpha', '2026-10-28', 'sent');
    await digest('Beta', '2026-10-28', 'failed');
    await digest('Beta', '2026-10-27', 'pending');
    const page = await listOrgDigests(deps, INST, {});
    expect(page.nextCursor).toBeNull();
    expect(page.data.map((d) => [d.team, d.date, d.status]).sort()).toEqual([
      ['Alpha', '2026-10-28', 'sent'],
      ['Beta', '2026-10-27', 'pending'],
      ['Beta', '2026-10-28', 'failed'],
    ]);
    const alpha = page.data.find((d) => d.team === 'Alpha');
    expect(alpha?.sentAt).toBeInstanceOf(Date);
    expect(alpha?.missing).toEqual(['bob']);
    const beta = page.data.find((d) => d.team === 'Beta' && d.date === '2026-10-28');
    expect(beta?.sentAt).toBeNull();
    expect(beta?.missing).toEqual(['bob', 'dave']);
    expect(Object.keys(alpha ?? {}).sort()).toEqual([
      'date',
      'missing',
      'sentAt',
      'status',
      'team',
    ]);
  });

  test('filters by team and date range, and ignores late daily deliveries', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await digest('Alpha', '2026-10-26', 'sent');
    await digest('Alpha', '2026-10-27', 'sent');
    await digest('Alpha', '2026-10-28', 'sent');
    await digest('Beta', '2026-10-27', 'sent');
    await claimDelivery(db, {
      installationId: INST,
      teamName: 'Alpha',
      date: '2026-10-28',
      kind: 'late_daily',
      subject: 'x',
    });
    const dates = async (q: Parameters<typeof listOrgDigests>[2]) =>
      (await listOrgDigests(deps, INST, q)).data.map((d) => `${d.team}:${d.date}`);
    expect(await dates({ team: 'Alpha' })).toEqual([
      'Alpha:2026-10-28',
      'Alpha:2026-10-27',
      'Alpha:2026-10-26',
    ]);
    expect(await dates({ team: 'Alpha', from: '2026-10-27', to: '2026-10-27' })).toEqual([
      'Alpha:2026-10-27',
    ]);
    expect(await dates({ from: '2026-10-28' })).toEqual(['Alpha:2026-10-28']);
    expect(await codeOf(listOrgDigests(deps, INST, { team: 'Nope' }))).toBe('invalid_request');
    expect(await codeOf(listOrgDigests(deps, INST, { from: 'soon' }))).toBe('invalid_request');
  });

  test('pages without repeats or gaps and isolates tenants', async () => {
    await seedOrg(twoTeams());
    await seedOrg(twoTeams(), { id: OTHER, accountLogin: 'globex' });
    const { deps } = fakeDeps();
    for (let d = 0; d < 7; d++) {
      const date = addCalendarDays('2026-10-01', d);
      await digest('Alpha', date, 'sent');
      await digest('Beta', date, 'sent');
    }
    await digest('Alpha', '2026-10-30', 'sent', OTHER);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listOrgDigests(deps, INST, { limit: 4, cursor });
      seen.push(...page.data.map((d) => `${d.team}:${d.date}`));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(14);
    expect(new Set(seen).size).toBe(14);
    expect(seen.some((s) => s.endsWith('2026-10-30'))).toBe(false);
  });

  test('a team removed from the config keeps its history with no missing list', async () => {
    await seedOrg(twoTeams());
    const { deps } = fakeDeps();
    await digest('Gone', '2026-10-28', 'sent');
    const [only] = (await listOrgDigests(deps, INST, {})).data;
    expect(only?.team).toBe('Gone');
    expect(only?.missing).toEqual([]);
  });
});

describe('cursor codec', () => {
  test('round trips and is opaque base64url', () => {
    const cursor = encodeCursor({ date: '2026-10-28', id: crypto.randomUUID() });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toMatchObject({ date: '2026-10-28' });
  });
});

describe('org read caching', () => {
  function counted(fake: ReturnType<typeof fakeDeps>) {
    let count = 0;
    const resolve = fake.deps.github.resolveTeamMembers;
    fake.deps.github.resolveTeamMembers = async (...args) => {
      count++;
      return resolve(...args);
    };
    return () => count;
  }

  test('two org reads resolve the teams once', async () => {
    await seedOrg(twoTeams());
    const fake = fakeDeps();
    const resolutions = counted(fake);
    await listOrgTeams(fake.deps, INST);
    await listOrgTeams(fake.deps, INST);
    expect(resolutions()).toBe(2);
  });

  test('loading the config invalidates the resolved teams', async () => {
    await seedOrg(twoTeams());
    const fake = fakeDeps({ source: { found: true, source: 'teams: nope' } });
    const resolutions = counted(fake);
    await listOrgTeams(fake.deps, INST);
    await loadInstallationConfig(fake.deps, INST, 'acme');
    await listOrgTeams(fake.deps, INST);
    expect(resolutions()).toBe(4);
  });
});
