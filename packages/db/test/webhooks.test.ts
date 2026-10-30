import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  claimWebhookDelivery,
  completeWebhookDelivery,
  failWebhookDelivery,
  getWebhookDelivery,
  insertWebhookDeliveries,
  insertWebhookEndpoint,
  listInstallationWebhookEndpoints,
  listOverdueWebhookDeliveries,
  listSubscribedWebhookEndpoints,
  retryWebhookDelivery,
  upsertInstallation,
} from '../src';
import { db, useCleanDb } from './setup';

useCleanDb();

const KEY = new Uint8Array(32).fill(3);
const INST = 11;
const NOW = new Date('2026-10-28T15:00:00Z');
const LEASE_MS = 5 * 60 * 1000;

async function seed() {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  const { id } = await insertWebhookEndpoint(
    db,
    {
      installationId: INST,
      url: 'https://hooks.example.com/',
      events: ['daily.submitted'],
      secret: 'whsec_plain',
    },
    KEY,
  );
  const [deliveryId] = await insertWebhookDeliveries(db, [
    {
      endpointId: id,
      event: 'daily.submitted',
      eventId: '33333333-3333-4333-8333-333333333333',
      payload: { hello: 'world' },
      nextAttemptAt: NOW,
    },
  ]);
  if (!deliveryId) throw new Error('no delivery');
  return { endpointId: id, deliveryId };
}

describe('webhook repo', () => {
  test('the secret is stored encrypted', async () => {
    const { endpointId } = await seed();
    const rows = await db.execute<{ secret_ciphertext: string }>(
      sql`SELECT secret_ciphertext FROM webhook_endpoints WHERE id = ${endpointId}`,
    );
    expect(rows[0]?.secret_ciphertext).toBeTruthy();
    expect(rows[0]?.secret_ciphertext).not.toContain('whsec_plain');
  });

  test('one delivery per endpoint and event id', async () => {
    const { endpointId } = await seed();
    const again = await insertWebhookDeliveries(db, [
      {
        endpointId,
        event: 'daily.submitted',
        eventId: '33333333-3333-4333-8333-333333333333',
        payload: {},
        nextAttemptAt: NOW,
      },
    ]);
    expect(again).toEqual([]);
  });

  test('subscribed endpoints are active ones of the installation with the event', async () => {
    const { endpointId } = await seed();
    expect(await listSubscribedWebhookEndpoints(db, INST, 'daily.submitted')).toEqual([endpointId]);
    expect(await listSubscribedWebhookEndpoints(db, INST, 'digest.sent')).toEqual([]);
    expect(await listSubscribedWebhookEndpoints(db, 99, 'daily.submitted')).toEqual([]);
  });

  test('a claim takes a lease and fences stale tokens', async () => {
    const { deliveryId } = await seed();
    const claim = await claimWebhookDelivery(db, deliveryId, NOW, LEASE_MS);
    expect(claim).toMatchObject({ attempts: 1, url: 'https://hooks.example.com/', active: true });
    expect(await claimWebhookDelivery(db, deliveryId, NOW, LEASE_MS)).toBeNull();
    const later = new Date(NOW.getTime() + LEASE_MS);
    const reclaim = await claimWebhookDelivery(db, deliveryId, later, LEASE_MS);
    expect(reclaim?.attempts).toBe(2);
    expect(await completeWebhookDelivery(db, deliveryId, 1, 200)).toBe(false);
    expect(await completeWebhookDelivery(db, deliveryId, 2, 204)).toBe(true);
    const row = await getWebhookDelivery(db, deliveryId);
    expect(row).toMatchObject({ status: 'delivered', attempts: 2, lastStatusCode: 204 });
    expect(await claimWebhookDelivery(db, deliveryId, later, LEASE_MS)).toBeNull();
  });

  test('retry reschedules and failure counts toward disabling the endpoint', async () => {
    const { deliveryId, endpointId } = await seed();
    await claimWebhookDelivery(db, deliveryId, NOW, LEASE_MS);
    const next = new Date(NOW.getTime() + 60_000);
    expect(
      await retryWebhookDelivery(db, deliveryId, 1, {
        statusCode: 500,
        error: 'http_500',
        nextAttemptAt: next,
      }),
    ).toBe(true);
    expect(await getWebhookDelivery(db, deliveryId)).toMatchObject({
      status: 'pending',
      nextAttemptAt: next,
      lastStatusCode: 500,
      lastError: 'http_500',
    });
    await claimWebhookDelivery(db, deliveryId, next, LEASE_MS);
    const result = await failWebhookDelivery(
      db,
      deliveryId,
      2,
      { statusCode: null, error: 'timeout' },
      1,
    );
    expect(result).toEqual({ failed: true, endpointDisabled: true });
    const [endpoint] = await listInstallationWebhookEndpoints(db, INST);
    expect(endpoint).toMatchObject({
      id: endpointId,
      active: false,
      disabledReason: 'failures',
      consecutiveFailures: 1,
    });
  });

  test('overdue pending deliveries are listed for requeueing', async () => {
    const { deliveryId } = await seed();
    expect(await listOverdueWebhookDeliveries(db, new Date(NOW.getTime() - 1), 10)).toEqual([]);
    expect(await listOverdueWebhookDeliveries(db, NOW, 10)).toEqual([deliveryId]);
  });

  test('deleting the installation cascades', async () => {
    const { deliveryId } = await seed();
    await db.execute(sql`DELETE FROM installations WHERE id = ${INST}`);
    expect(await getWebhookDelivery(db, deliveryId)).toBeNull();
  });
});
