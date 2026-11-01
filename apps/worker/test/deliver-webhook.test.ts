import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  deactivateWebhookEndpoint,
  getWebhookDelivery,
  insertWebhookEndpoint,
  listInstallationWebhookEndpoints,
  upsertInstallation,
} from '@standcast/db';
import {
  emitEvent,
  nullTracker,
  type SafeFetchOptions,
  verifyWebhookSignature,
  type WorkerDeps,
} from '@standcast/orchestrator';
import { createMemoryQueue } from '@standcast/queue';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { deliverWebhookJob, requeueWebhooksJob } from '../src/jobs/deliver-webhook';

useCleanDb();

const INST = 11;
const KEY = new Uint8Array(32).fill(5);
const SECRET = 'whsec_receiver-secret';
const START = new Date('2026-10-28T15:00:00Z');
const MINUTE = 60_000;
const BACKOFF = [1, 5, 30, 120, 360, 720, 1440].map((m) => m * MINUTE);

type Received = { path: string; headers: Headers; body: string };

const received: Received[] = [];
let status = 200;

const receiver = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: async (req) => {
    received.push({
      path: new URL(req.url).pathname,
      headers: req.headers,
      body: await req.text(),
    });
    return new Response('thanks', { status });
  },
});

afterAll(() => receiver.stop(true));

beforeEach(() => {
  received.length = 0;
  status = 200;
});

function harness(resolved: string[] = ['93.184.216.34']) {
  let now = START;
  const queue = createMemoryQueue();
  const transport: SafeFetchOptions = {
    resolve: async () => resolved,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(String(input));
      return fetch(`http://127.0.0.1:${receiver.port}${target.pathname}${target.search}`, init);
    }) as typeof fetch,
  };
  const deps: WorkerDeps = {
    db,
    queue,
    now: () => now,
    encryptionKey: KEY,
    chatFor: async () => null,
    github: {} as WorkerDeps['github'],
    webhookTransport: transport,
    trackerFor: async () => nullTracker,
    linear: {
      exchangeCode: async () => {
        throw new Error('unused');
      },
      refreshToken: async () => {
        throw new Error('unused');
      },
    },
    email: null,
    env: {
      linearClientId: 'lid',
      linearClientSecret: 'lsecret',
      supportEmail: 'help@sw.test',
      betaEmailFrom: '',
    },
  };
  return {
    deps,
    queue,
    run: deliverWebhookJob(deps),
    setNow: (d: Date) => {
      now = d;
    },
    now: () => now,
  };
}

async function seedEndpoint(path = '/standcast') {
  await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
  const { id } = await insertWebhookEndpoint(
    db,
    {
      installationId: INST,
      url: `https://hooks.example.com${path}`,
      events: ['digest.sent'],
      secret: SECRET,
    },
    KEY,
  );
  return id;
}

async function emitDigest(h: ReturnType<typeof harness>): Promise<string> {
  const before = h.queue.enqueued.length;
  await emitEvent(h.deps, INST, {
    type: 'digest.sent',
    data: { team: 'Alpha', date: '2026-10-28', submitted: ['alice'], missing: [] },
  });
  const job = h.queue.enqueued[before];
  if (!job) throw new Error('nothing enqueued');
  return (job.data as { deliveryId: string }).deliveryId;
}

describe('deliver-webhook', () => {
  test('delivery succeeds', async () => {
    await seedEndpoint();
    const h = harness();
    const deliveryId = await emitDigest(h);
    await h.run({ deliveryId });
    expect(received).toHaveLength(1);
    const [request] = received;
    if (!request) throw new Error('no request');
    expect(request.path).toBe('/standcast');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('user-agent')).toBe('Standcast-Webhooks/1');
    expect(request.headers.get('standcast-event')).toBe('digest.sent');
    expect(request.headers.get('standcast-delivery')).toBe(deliveryId);
    const signature = request.headers.get('standcast-signature') ?? '';
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature(SECRET, request.body, signature, Math.floor(START.getTime() / 1000)),
    ).toBe(true);
    const envelope = JSON.parse(request.body);
    expect(envelope).toMatchObject({
      type: 'digest.sent',
      installation: { id: INST, login: 'acme' },
      data: { team: 'Alpha', submitted: ['alice'] },
    });
    expect(await getWebhookDelivery(db, deliveryId)).toMatchObject({
      status: 'delivered',
      attempts: 1,
      lastStatusCode: 200,
      lastError: null,
    });
    await h.run({ deliveryId });
    expect(received).toHaveLength(1);
  });

  test('retry with backoff', async () => {
    await seedEndpoint();
    status = 500;
    const h = harness();
    const deliveryId = await emitDigest(h);
    await h.run({ deliveryId });
    let row = await getWebhookDelivery(db, deliveryId);
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastStatusCode: 500 });
    expect(row?.nextAttemptAt.getTime()).toBe(START.getTime() + MINUTE);
    const retry = h.queue.enqueued.at(-1);
    expect(retry).toEqual({
      name: 'deliver-webhook',
      data: { deliveryId },
      startAfter: new Date(START.getTime() + MINUTE),
    });

    await h.run({ deliveryId });
    expect(received).toHaveLength(1);

    let at = START.getTime();
    for (const [index, delay] of BACKOFF.entries()) {
      at += delay;
      h.setNow(new Date(at));
      await h.run({ deliveryId });
      row = await getWebhookDelivery(db, deliveryId);
      expect(row?.attempts).toBe(index + 2);
    }
    expect(received).toHaveLength(8);
    expect(row).toMatchObject({ status: 'failed', attempts: 8, lastStatusCode: 500 });
    const delays = h.queue.enqueued
      .filter((j) => j.name === 'deliver-webhook' && j.startAfter)
      .map((j, i, all) =>
        i === 0
          ? (j.startAfter?.getTime() ?? 0) - START.getTime()
          : (j.startAfter?.getTime() ?? 0) - (all[i - 1]?.startAfter?.getTime() ?? 0),
      );
    expect(delays).toEqual(BACKOFF);
    h.setNow(new Date(at + 7 * 24 * 60 * MINUTE));
    await h.run({ deliveryId });
    expect(received).toHaveLength(8);
  });

  test('a private address at delivery time is never contacted', async () => {
    await seedEndpoint();
    const h = harness(['10.0.0.7']);
    const deliveryId = await emitDigest(h);
    await h.run({ deliveryId });
    expect(received).toHaveLength(0);
    expect(await getWebhookDelivery(db, deliveryId)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: null,
      lastError: 'blocked_address',
    });
  });

  test('a redirect counts as a failure and is not followed', async () => {
    await seedEndpoint();
    status = 302;
    const h = harness();
    const deliveryId = await emitDigest(h);
    await h.run({ deliveryId });
    expect(received).toHaveLength(1);
    expect(await getWebhookDelivery(db, deliveryId)).toMatchObject({
      status: 'pending',
      lastStatusCode: 302,
      lastError: 'http_302',
    });
  });

  test('a disabled endpoint fails its pending deliveries without sending', async () => {
    const endpointId = await seedEndpoint();
    const h = harness();
    const deliveryId = await emitDigest(h);
    await deactivateWebhookEndpoint(db, INST, endpointId, 'manual');
    await h.run({ deliveryId });
    expect(received).toHaveLength(0);
    expect(await getWebhookDelivery(db, deliveryId)).toMatchObject({
      status: 'failed',
      lastError: 'endpoint_disabled',
    });
  });

  test('20 failed deliveries in a row disable the endpoint; a success resets the count', async () => {
    await seedEndpoint();
    const h = harness();
    const exhaust = async () => {
      const deliveryId = await emitDigest(h);
      for (let i = 0; i < 8; i++) {
        await h.run({ deliveryId });
        h.setNow(new Date(h.now().getTime() + 25 * 60 * MINUTE));
      }
      return deliveryId;
    };
    status = 500;
    for (let i = 0; i < 19; i++) await exhaust();
    status = 200;
    await h.run({ deliveryId: await emitDigest(h) });
    let [endpoint] = await listInstallationWebhookEndpoints(db, INST);
    expect(endpoint).toMatchObject({ active: true, consecutiveFailures: 0 });
    status = 500;
    for (let i = 0; i < 19; i++) await exhaust();
    [endpoint] = await listInstallationWebhookEndpoints(db, INST);
    expect(endpoint).toMatchObject({ active: true, consecutiveFailures: 19 });
    await exhaust();
    [endpoint] = await listInstallationWebhookEndpoints(db, INST);
    expect(endpoint).toMatchObject({
      active: false,
      disabledReason: 'failures',
      consecutiveFailures: 20,
    });
    const before = h.queue.enqueued.length;
    await emitDigest(h).catch(() => '');
    expect(h.queue.enqueued.length).toBe(before);
  }, 30_000);

  test('overdue deliveries are requeued by the sweep', async () => {
    await seedEndpoint();
    const h = harness();
    const deliveryId = await emitDigest(h);
    h.queue.enqueued.length = 0;
    await requeueWebhooksJob(h.deps)();
    expect(h.queue.enqueued).toEqual([]);
    h.setNow(new Date(START.getTime() + 10 * MINUTE));
    await requeueWebhooksJob(h.deps)();
    expect(h.queue.enqueued).toEqual([{ name: 'deliver-webhook', data: { deliveryId } }]);
  });

  test('rejects malformed job data', async () => {
    const h = harness();
    await expect(h.run({ deliveryId: 'nope' })).rejects.toThrow();
  });
});
