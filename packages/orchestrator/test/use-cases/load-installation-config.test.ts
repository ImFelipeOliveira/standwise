import { describe, expect, test } from 'bun:test';
import {
  getInstallation,
  listOperationalInstallations,
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
