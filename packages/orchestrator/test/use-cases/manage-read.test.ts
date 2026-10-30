import { beforeEach, describe, expect, test } from 'bun:test';
import { parseConfig, type StandwiseConfig } from '@standwise/core';
import {
  addMemberInstallation,
  claimDelivery,
  type MemberRow,
  upsertDaily,
  upsertMember,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  createMembershipCheck,
  DomainError,
  listManagedBlockers,
  listManagedDailies,
  listManagedDigests,
  listManagedTeams,
  readableTeams,
} from '../../src';
import { fakeDeps, INST, seedOrg } from './fakes';

useCleanDb();

function teams(): StandwiseConfig {
  const parsed = parseConfig(`
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [Carol]
    members: [alice, bob]
    chat: { provider: slack, channel: "#backend" }
  - name: platform
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [dave]
    members: [bob, erin]
    chat: { provider: slack, channel: "#platform" }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.config;
}

const LOGINS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
const people: Record<string, MemberRow> = {};

beforeEach(async () => {
  for (const [i, login] of LOGINS.entries()) {
    people[login] = await upsertMember(db, { githubUserId: 100 + i, login, email: null });
  }
});

const who = (login: string) => {
  const member = people[login];
  if (!member) throw new Error(login);
  return member;
};

function harness() {
  const fake = fakeDeps();
  for (const [i, login] of LOGINS.entries()) {
    fake.users.set(100 + i, login);
    fake.orgMembers.add(login);
  }
  return { ...fake, isMember: createMembershipCheck(fake.deps) };
}

async function setup() {
  await seedOrg(teams());
  for (const login of LOGINS) await addMemberInstallation(db, who(login).id, INST);
  return harness();
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof DomainError ? error.code : undefined;
}

async function submit(login: string, date: string, blockers: string[] = []) {
  await upsertDaily(db, {
    installationId: INST,
    memberId: who(login).id,
    date,
    payload: {
      org: 'acme',
      yesterday: [{ text: `y ${login}` }],
      today: [{ text: `t ${login}` }],
      blockers: blockers.map((text) => ({ text })),
    },
    submittedAt: new Date(`${date}T12:00:00Z`),
  });
}

describe('readableTeams', () => {
  const canReadTeam = async (
    deps: ReturnType<typeof harness>['deps'],
    installationId: number,
    member: MemberRow,
    team: string,
  ) => (await readableTeams(deps, installationId, member)).some((t) => t.name === team);

  test('a manager reads only the teams they manage, matched case-insensitively', async () => {
    await seedOrg(teams());
    const { deps } = harness();
    expect(await canReadTeam(deps, INST, who('carol'), 'backend')).toBe(true);
    expect(await canReadTeam(deps, INST, who('carol'), 'platform')).toBe(false);
    expect(await canReadTeam(deps, INST, who('dave'), 'platform')).toBe(true);
  });

  test('the manager is matched by the current login of the github id', async () => {
    await seedOrg(teams());
    const renamed = await upsertMember(db, { githubUserId: 500, login: 'old-carol', email: null });
    const stale = await upsertMember(db, { githubUserId: 501, login: 'carol2', email: null });
    const { deps, users } = harness();
    users.set(500, 'carol');
    users.set(501, 'someone-else');
    expect(await canReadTeam(deps, INST, renamed, 'backend')).toBe(true);
    expect(await canReadTeam(deps, INST, { ...stale, login: 'carol' }, 'backend')).toBe(false);
  });

  test('an installation admin reads every team', async () => {
    await seedOrg(teams());
    const { deps, roles } = harness();
    roles.set('frank', { role: 'admin', state: 'active' });
    expect(await canReadTeam(deps, INST, who('frank'), 'backend')).toBe(true);
    expect(await canReadTeam(deps, INST, who('frank'), 'platform')).toBe(true);
  });

  test('a plain member reads no team, not even their own', async () => {
    await seedOrg(teams());
    const { deps } = harness();
    expect(await canReadTeam(deps, INST, who('alice'), 'backend')).toBe(false);
    expect(await canReadTeam(deps, INST, who('bob'), 'platform')).toBe(false);
  });

  test('unknown teams and unconfigured installations are never readable', async () => {
    const { deps, roles } = harness();
    roles.set('frank', { role: 'admin', state: 'active' });
    expect(await canReadTeam(deps, INST, who('frank'), 'backend')).toBe(false);
    await seedOrg(null);
    expect(await canReadTeam(deps, INST, who('frank'), 'backend')).toBe(false);
    await seedOrg(teams());
    expect(await canReadTeam(deps, INST, who('frank'), 'nope')).toBe(false);
  });
});

describe('listManagedTeams', () => {
  test('lists only the teams the person can read', async () => {
    const { deps, isMember, roles } = await setup();
    roles.set('frank', { role: 'admin', state: 'active' });
    const names = async (login: string) =>
      (await listManagedTeams(deps, isMember, who(login), 'ACME')).map((t) => t.name);
    expect(await names('carol')).toEqual(['backend']);
    expect(await names('frank')).toEqual(['backend', 'platform']);
    expect(await names('alice')).toEqual([]);
  });

  test('requires a known org the person belongs to', async () => {
    const { deps, isMember, orgMembers } = await setup();
    expect(await codeOf(listManagedTeams(deps, isMember, who('carol'), undefined))).toBe(
      'invalid_request',
    );
    expect(await codeOf(listManagedTeams(deps, isMember, who('carol'), 'globex'))).toBe(
      'org_not_found',
    );
    orgMembers.delete('carol');
    expect(await codeOf(listManagedTeams(deps, isMember, who('carol'), 'acme'))).toBe('forbidden');
  });

  test('an unconfigured org is org_not_configured', async () => {
    const { deps, isMember } = await setup();
    await seedOrg(null);
    expect(await codeOf(listManagedTeams(deps, isMember, who('carol'), 'acme'))).toBe(
      'org_not_configured',
    );
  });
});

describe('team reads', () => {
  test('a backend manager reads backend and is forbidden on platform and unknown teams', async () => {
    const { deps, isMember } = await setup();
    await submit('alice', '2026-10-27');
    await submit('erin', '2026-10-27');
    const page = await listManagedDailies(deps, isMember, who('carol'), {
      org: 'acme',
      team: 'backend',
      from: '2026-10-27',
      to: '2026-10-28',
    });
    expect(page.data.map((d) => d.login)).toEqual(['alice']);
    for (const team of ['platform', 'ghost']) {
      expect(
        await codeOf(
          listManagedDailies(deps, isMember, who('carol'), {
            org: 'acme',
            team,
            from: '2026-10-27',
            to: '2026-10-28',
          }),
        ),
      ).toBe('forbidden');
    }
  });

  test('an admin reads both teams and a plain member reads none', async () => {
    const { deps, isMember, roles } = await setup();
    roles.set('frank', { role: 'admin', state: 'active' });
    await submit('bob', '2026-10-27', ['waiting on infra']);
    for (const team of ['backend', 'platform']) {
      const page = await listManagedBlockers(deps, isMember, who('frank'), { org: 'acme', team });
      expect(page.data.map((b) => b.text)).toEqual(['waiting on infra']);
      expect(
        await codeOf(listManagedBlockers(deps, isMember, who('alice'), { org: 'acme', team })),
      ).toBe('forbidden');
    }
  });

  test('team names in dailies and blockers are limited to the teams the caller can read', async () => {
    const { deps, isMember, roles } = await setup();
    roles.set('frank', { role: 'admin', state: 'active' });
    await submit('bob', '2026-10-27', ['waiting on infra']);
    const query = { org: 'acme', team: 'backend' };
    const dailies = await listManagedDailies(deps, isMember, who('carol'), query);
    expect(dailies.data.map((d) => d.teams)).toEqual([['backend']]);
    const blockers = await listManagedBlockers(deps, isMember, who('carol'), query);
    expect(blockers.data.map((b) => b.teams)).toEqual([['backend']]);
    const admin = await listManagedDailies(deps, isMember, who('frank'), query);
    expect(admin.data.map((d) => d.teams)).toEqual([['backend', 'platform']]);
  });

  test('team is required', async () => {
    const { deps, isMember } = await setup();
    expect(await codeOf(listManagedDigests(deps, isMember, who('carol'), { org: 'acme' }))).toBe(
      'invalid_request',
    );
  });

  test('history is limited to the last 90 days in the team time zone', async () => {
    const { deps, isMember, setNow } = await setup();
    setNow(new Date('2026-10-29T02:00:00Z'));
    const read = (from?: string, to?: string) =>
      listManagedDailies(deps, isMember, who('carol'), { org: 'acme', team: 'backend', from, to });
    expect((await read('2026-07-31', '2026-10-28')).data).toEqual([]);
    expect(await codeOf(read('2026-07-30', '2026-10-28'))).toBe('invalid_request');
    expect(await codeOf(read('2026-10-01', '2026-10-29'))).toBe('invalid_request');
    expect(await codeOf(read('2026-10-20', '2026-10-10'))).toBe('invalid_request');
    expect(await codeOf(read('2026-10-1', '2026-10-10'))).toBe('invalid_request');
  });

  test('without from and to, blockers default to the 90-day window', async () => {
    const { deps, isMember } = await setup();
    await submit('alice', '2026-07-30', ['too old']);
    await submit('alice', '2026-07-31', ['oldest kept']);
    await submit('bob', '2026-10-28', ['recent']);
    const page = await listManagedBlockers(deps, isMember, who('carol'), {
      org: 'acme',
      team: 'backend',
    });
    expect(page.data.map((b) => b.text)).toEqual(['recent', 'oldest kept']);
  });

  test('digests are filtered by team and range', async () => {
    const { deps, isMember } = await setup();
    for (const [team, date] of [
      ['backend', '2026-10-27'],
      ['backend', '2026-10-20'],
      ['platform', '2026-10-27'],
    ] as const) {
      await claimDelivery(db, { installationId: INST, kind: 'digest', teamName: team, date });
    }
    const page = await listManagedDigests(deps, isMember, who('carol'), {
      org: 'acme',
      team: 'backend',
      from: '2026-10-27',
      to: '2026-10-27',
    });
    expect(page.data.map((d) => [d.team, d.date])).toEqual([['backend', '2026-10-27']]);
  });
});
