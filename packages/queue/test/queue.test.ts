import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createMemoryQueue, createPgBossQueue, type JobQueue } from '../src';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://standwise:standwise@localhost:5433/standwise_test';
const PGBOSS_SCHEMA = 'pgboss_test';

const admin = new SQL(TEST_DATABASE_URL);
await admin.unsafe(`DROP SCHEMA IF EXISTS ${PGBOSS_SCHEMA} CASCADE`);
await admin.close();

type Harness = { queue: JobQueue; settle: (done: () => boolean) => Promise<void> };

const implementations: [string, () => Harness][] = [
  [
    'memory',
    () => {
      const queue = createMemoryQueue();
      return { queue, settle: () => queue.drain() };
    },
  ],
  [
    'pg-boss',
    () => ({
      queue: createPgBossQueue(TEST_DATABASE_URL, {
        schema: PGBOSS_SCHEMA,
        pollingIntervalSeconds: 0.5,
        retryDelaySeconds: 0,
      }),
      settle: async (done) => {
        const deadline = Date.now() + 10_000;
        while (!done() && Date.now() < deadline) await Bun.sleep(50);
        await Bun.sleep(1_200);
      },
    }),
  ],
];

describe.each(implementations)('JobQueue (%s)', (_label, make) => {
  let h: Harness;
  beforeAll(async () => {
    h = make();
    await h.queue.start();
  });
  afterAll(async () => {
    await h.queue.stop();
  });

  test('work receives enqueued data', async () => {
    const received: object[] = [];
    await h.queue.work<{ n: number }>('receive', async (data) => {
      received.push(data);
    });
    await h.queue.enqueue('receive', { n: 7 });
    await h.settle(() => received.length >= 1);
    expect(received).toEqual([{ n: 7 }]);
  });

  test('singletonKey dedupes', async () => {
    let calls = 0;
    await h.queue.work('dedupe', async () => {
      calls++;
    });
    await h.queue.enqueue('dedupe', { a: 1 }, { singletonKey: 'k' });
    await h.queue.enqueue('dedupe', { a: 2 }, { singletonKey: 'k' });
    await h.settle(() => calls >= 1);
    expect(calls).toBe(1);
  });

  test('failing handler retries up to retryLimit', async () => {
    let calls = 0;
    await h.queue.work('flaky', async () => {
      calls++;
      throw new Error('boom');
    });
    await h.queue.enqueue('flaky', {}, { retryLimit: 2 });
    await h.settle(() => calls >= 3);
    expect(calls).toBe(3);
  });

  test('singletonKey does not dedupe across completion', async () => {
    let calls = 0;
    await h.queue.work('rerun', async () => {
      calls++;
    });
    await h.queue.enqueue('rerun', {}, { singletonKey: 'K' });
    await h.settle(() => calls >= 1);
    await h.queue.enqueue('rerun', {}, { singletonKey: 'K' });
    await h.settle(() => calls >= 2);
    expect(calls).toBe(2);
  });

  test('enqueue of own key from a running handler is dropped', async () => {
    let calls = 0;
    await h.queue.work('self', async () => {
      calls++;
      await h.queue.enqueue('self', {}, { singletonKey: 'K' });
    });
    await h.queue.enqueue('self', {}, { singletonKey: 'K' });
    await h.settle(() => calls >= 1);
    expect(calls).toBe(1);
  });
});
