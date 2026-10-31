import { describe, expect, test } from 'bun:test';
import {
  getInstallation,
  listOperationalInstallations,
  markConnectionInvalid,
  saveConnection,
  setMemberInstallations,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  createMembershipCheck,
  getSetupStatus,
  loadInstallationConfig,
  resolveOrgContext,
} from '../../src';
import { type FakeOptions, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const VALID = `teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#alpha" }
`;

const noAccess: FakeOptions['source'] = { found: false, reason: 'no_access' };

async function load(source: FakeOptions['source']) {
  const fake = fakeDeps({ source });
  const status = await loadInstallationConfig(fake.deps, INST, 'acme');
  return { ...fake, status };
}

describe('loadInstallationConfig access errors', () => {
  test('no_access keeps a configured installation operational with a warning', async () => {
    await seedOrg();
    const member = await seedMember();
    await setMemberInstallations(db, member.id, [INST]);
    const { deps, status, roles } = await load(noAccess);
    expect(status).toBe('configured');
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('configured');
    expect(row?.config).not.toBeNull();
    expect(row?.accessWarning).toBe('no_access');
    expect((await listOperationalInstallations(db)).map((i) => i.id)).toEqual([INST]);
    const isMember = createMembershipCheck(deps);
    expect((await resolveOrgContext(deps, isMember, member, 'acme')).installationId).toBe(INST);
    roles.set('alice', { role: 'member', state: 'active' });
    expect((await getSetupStatus(deps, isMember, member, INST)).accessWarning).toBe('no_access');
  });

  test('no_access keeps an invalid installation with its last valid config', async () => {
    await seedOrg();
    await load({ found: true, source: 'teams: nope' });
    await load(noAccess);
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('invalid');
    expect(row?.config).not.toBeNull();
    expect(row?.accessWarning).toBe('no_access');
  });

  test('no_access without any config leaves the installation unconfigured', async () => {
    await seedOrg(null);
    const { status } = await load(noAccess);
    expect(status).toBe('unconfigured');
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('unconfigured');
    expect(row?.unconfiguredReason).toBe('no_access');
    expect(row?.accessWarning).toBeNull();
  });

  test('a configured load clears the warning', async () => {
    await seedOrg();
    await load(noAccess);
    await load({ found: true, source: VALID });
    expect((await getInstallation(db, INST))?.accessWarning).toBeNull();
  });

  test('an invalid load clears the warning', async () => {
    await seedOrg();
    await load(noAccess);
    await load({ found: true, source: 'teams: nope' });
    expect((await getInstallation(db, INST))?.accessWarning).toBeNull();
  });

  for (const reason of ['no_file', 'no_repo'] as const) {
    test(`${reason} still drops the config and the warning`, async () => {
      await seedOrg();
      await load(noAccess);
      await load({ found: false, reason });
      const row = await getInstallation(db, INST);
      expect(row?.status).toBe('unconfigured');
      expect(row?.config).toBeNull();
      expect(row?.unconfiguredReason).toBe(reason);
      expect(row?.accessWarning).toBeNull();
      expect(await listOperationalInstallations(db)).toEqual([]);
    });
  }
});

describe('relinking linear identities after a config load', () => {
  const LINEAR_TEAM = `${VALID}    tracker: { provider: linear, team: ENG }
members:
  bob: { linear: bob@corp.com }
`;

  async function connectLinear() {
    await saveConnection(
      db,
      INST,
      'linear',
      'org-1',
      '{}',
      new Uint8Array(32).fill(7),
      'Acme',
      'acme',
    );
  }

  async function loadWithSpy(source: string) {
    const fake = fakeDeps({ source: { found: true, source } });
    const options: unknown[] = [];
    const enqueue = fake.deps.queue.enqueue.bind(fake.deps.queue);
    fake.deps.queue.enqueue = async (name, data, opts) => {
      options.push({ name, opts });
      return enqueue(name, data, opts);
    };
    await loadInstallationConfig(fake.deps, INST, 'acme');
    return { ...fake, options };
  }

  test('a linear team with a connection enqueues the link job', async () => {
    await seedOrg();
    await connectLinear();
    const { queue, options } = await loadWithSpy(LINEAR_TEAM);
    expect(queue.enqueued).toEqual([
      { name: 'link-tracker-identities', data: { installationId: INST } },
    ]);
    expect(options).toEqual([
      { name: 'link-tracker-identities', opts: { singletonKey: `link-tracker:${INST}` } },
    ]);
  });

  test('no linear team, no connection or an invalid connection enqueues nothing', async () => {
    await seedOrg();
    expect((await loadWithSpy(LINEAR_TEAM)).queue.enqueued).toEqual([]);
    await connectLinear();
    expect((await loadWithSpy(VALID)).queue.enqueued).toEqual([]);
    await markConnectionInvalid(db, INST, 'linear');
    expect((await loadWithSpy(LINEAR_TEAM)).queue.enqueued).toEqual([]);
  });

  test('an invalid config enqueues nothing', async () => {
    await seedOrg();
    await connectLinear();
    expect((await loadWithSpy('teams: nope')).queue.enqueued).toEqual([]);
  });
});
