import { describe, expect, test } from 'bun:test';
import {
  getWebhookDelivery,
  getWebhookEndpointSecret,
  insertWebhookDeliveries,
  insertWebhookEndpoint,
  listInstallationWebhookEndpoints,
  setMemberInstallations,
} from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import {
  createMembershipCheck,
  createWebhookEndpoint,
  DomainError,
  disableWebhookEndpoint,
  type Envelope,
  isInstallationAdmin,
  listWebhookEndpoints,
  sendTestEvent,
} from '../../src';
import { fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

const OTHER = 22;
const URL_OK = 'https://hooks.example.com/standwise';

async function setup(admin = true) {
  await seedOrg();
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  if (admin) fake.roles.set('alice', { role: 'admin', state: 'active' });
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof DomainError ? error.code : undefined;
}

const input = {
  installationId: INST,
  url: URL_OK,
  events: ['daily.submitted' as const, 'blocker.opened' as const],
};

describe('createWebhookEndpoint', () => {
  test('an admin creates an endpoint with a one-time secret', async () => {
    const { deps, isMember, member } = await setup();
    const { id, secret } = await createWebhookEndpoint(deps, isMember, member, {
      ...input,
      events: ['daily.submitted', 'blocker.opened', 'daily.submitted'],
    });
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const [listed] = await listInstallationWebhookEndpoints(db, INST);
    expect(listed).toMatchObject({
      id,
      url: URL_OK,
      events: ['daily.submitted', 'blocker.opened'],
      active: true,
      disabledReason: null,
    });
    expect(await getWebhookEndpointSecret(db, INST, id, deps.encryptionKey)).toBe(secret);
  });

  test.each([
    ['http', { ...input, url: 'http://hooks.example.com/x' }],
    ['credentials', { ...input, url: 'https://user:pw@hooks.example.com/x' }],
    ['port', { ...input, url: 'https://hooks.example.com:8443/x' }],
    ['private ip', { ...input, url: 'https://10.0.0.5/x' }],
    ['loopback v6', { ...input, url: 'https://[::1]/x' }],
    ['metadata', { ...input, url: 'https://169.254.169.254/x' }],
    ['localhost', { ...input, url: 'https://localhost/x' }],
    ['not a url', { ...input, url: 'hooks' }],
    ['too long', { ...input, url: `https://hooks.example.com/${'a'.repeat(2048)}` }],
    ['no events', { ...input, events: [] }],
    ['unknown event', { ...input, events: ['ping' as never] }],
  ])('%s is invalid_request', async (_label, bad) => {
    const { deps, isMember, member } = await setup();
    expect(await codeOf(createWebhookEndpoint(deps, isMember, member, bad))).toBe(
      'invalid_request',
    );
    expect(await listInstallationWebhookEndpoints(db, INST)).toEqual([]);
  });

  test('explicit port 443 is accepted', async () => {
    const { deps, isMember, member } = await setup();
    await createWebhookEndpoint(deps, isMember, member, {
      ...input,
      url: 'https://hooks.example.com:443/x',
    });
    expect(await listInstallationWebhookEndpoints(db, INST)).toHaveLength(1);
  });

  test('at most 10 endpoints per installation', async () => {
    const { deps, isMember, member } = await setup();
    for (let i = 0; i < 10; i++) await createWebhookEndpoint(deps, isMember, member, input);
    expect(await codeOf(createWebhookEndpoint(deps, isMember, member, input))).toBe(
      'invalid_request',
    );
  });

  test('a non-admin member is forbidden and nothing is created', async () => {
    const { deps, isMember, member } = await setup(false);
    expect(await codeOf(createWebhookEndpoint(deps, isMember, member, input))).toBe('forbidden');
    expect(await listInstallationWebhookEndpoints(db, INST)).toEqual([]);
  });

  test('an admin demoted after a cached positive is forbidden', async () => {
    const { deps, isMember, member, roles } = await setup();
    expect(await isInstallationAdmin(deps, INST, member)).toBe(true);
    roles.clear();
    expect(await codeOf(createWebhookEndpoint(deps, isMember, member, input))).toBe('forbidden');
  });
});

describe('disableWebhookEndpoint', () => {
  test('an admin disables an endpoint', async () => {
    const { deps, isMember, member } = await setup();
    const { id } = await createWebhookEndpoint(deps, isMember, member, input);
    await disableWebhookEndpoint(deps, isMember, member, INST, id);
    const [listed] = await listInstallationWebhookEndpoints(db, INST);
    expect(listed).toMatchObject({ active: false, disabledReason: 'manual' });
    expect(await codeOf(disableWebhookEndpoint(deps, isMember, member, INST, id))).toBe(
      'not_found',
    );
  });

  test('unknown, malformed and foreign ids are not_found', async () => {
    const { deps, isMember, member } = await setup();
    await seedOrg(undefined, { id: OTHER, accountLogin: 'globex' });
    const foreign = await insertWebhookEndpoint(
      db,
      { installationId: OTHER, url: URL_OK, events: ['digest.sent'], secret: 'whsec_x' },
      deps.encryptionKey,
    );
    for (const id of ['nope', '00000000-0000-4000-8000-000000000000', foreign.id]) {
      expect(await codeOf(disableWebhookEndpoint(deps, isMember, member, INST, id))).toBe(
        'not_found',
      );
    }
    const [other] = await listInstallationWebhookEndpoints(db, OTHER);
    expect(other?.active).toBe(true);
  });

  test('a non-admin cannot disable', async () => {
    const { deps, isMember, member, roles } = await setup();
    const { id } = await createWebhookEndpoint(deps, isMember, member, input);
    roles.clear();
    expect(await codeOf(disableWebhookEndpoint(deps, isMember, member, INST, id))).toBe(
      'forbidden',
    );
  });
});

describe('sendTestEvent', () => {
  test('enqueues a ping to that endpoint only, whatever its subscriptions', async () => {
    const { deps, isMember, member, queue } = await setup();
    const { id } = await createWebhookEndpoint(deps, isMember, member, {
      ...input,
      events: ['digest.sent'],
    });
    await createWebhookEndpoint(deps, isMember, member, input);
    const { deliveryId } = await sendTestEvent(deps, isMember, member, INST, id);
    expect(queue.enqueued).toEqual([{ name: 'deliver-webhook', data: { deliveryId } }]);
    const row = await getWebhookDelivery(db, deliveryId);
    expect(row?.endpointId).toBe(id);
    expect(row?.event).toBe('ping');
    expect(row?.payload as Envelope).toEqual({
      id: row?.eventId as string,
      type: 'ping',
      created_at: '2026-10-28T15:00:00.000Z',
      installation: { id: INST, login: 'acme' },
      data: { endpoint_id: id },
    });
  });

  test('a disabled or foreign endpoint is not_found', async () => {
    const { deps, isMember, member, queue } = await setup();
    const { id } = await createWebhookEndpoint(deps, isMember, member, input);
    await disableWebhookEndpoint(deps, isMember, member, INST, id);
    expect(await codeOf(sendTestEvent(deps, isMember, member, INST, id))).toBe('not_found');
    expect(await codeOf(sendTestEvent(deps, isMember, member, INST, 'x'))).toBe('not_found');
    expect(queue.enqueued).toEqual([]);
  });

  test('a non-admin cannot send a test event', async () => {
    const { deps, isMember, member, roles } = await setup();
    const { id } = await createWebhookEndpoint(deps, isMember, member, input);
    roles.clear();
    expect(await codeOf(sendTestEvent(deps, isMember, member, INST, id))).toBe('forbidden');
  });
});

describe('listWebhookEndpoints', () => {
  test('lists endpoints and the latest 20 deliveries of the installation only', async () => {
    const { deps, isMember, member, setNow } = await setup();
    const { id } = await createWebhookEndpoint(deps, isMember, member, input);
    await seedOrg(undefined, { id: OTHER, accountLogin: 'globex' });
    const foreign = await insertWebhookEndpoint(
      db,
      {
        installationId: OTHER,
        url: 'https://other.example.com/',
        events: ['digest.sent'],
        secret: 'whsec_y',
      },
      deps.encryptionKey,
    );
    const base = new Date('2026-10-28T15:00:00Z').getTime();
    for (let i = 0; i < 25; i++) {
      setNow(new Date(base + i * 1000));
      await sendTestEvent(deps, isMember, member, INST, id);
    }
    await insertWebhookDeliveries(db, [
      {
        endpointId: foreign.id,
        event: 'ping',
        eventId: '22222222-2222-4222-8222-222222222222',
        payload: {},
        nextAttemptAt: new Date(base + 60_000),
        createdAt: new Date(base + 60_000),
      },
    ]);
    const overview = await listWebhookEndpoints(deps, isMember, member, INST);
    expect(overview.endpoints.map((e) => e.id)).toEqual([id]);
    expect(overview.deliveries).toHaveLength(20);
    expect(overview.deliveries.every((d) => d.endpointUrl === URL_OK)).toBe(true);
    expect(overview.deliveries[0]?.createdAt.getTime()).toBe(base + 24_000);
    expect(overview.deliveries[0]).toMatchObject({
      event: 'ping',
      status: 'pending',
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
    });
  });

  test('a non-admin cannot list', async () => {
    const { deps, isMember, member } = await setup(false);
    expect(await codeOf(listWebhookEndpoints(deps, isMember, member, INST))).toBe('forbidden');
  });
});
