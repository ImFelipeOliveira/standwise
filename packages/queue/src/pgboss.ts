import { errorFields } from '@standcast/core';
import { PgBoss } from 'pg-boss';
import {
  DEFAULT_RETRY_LIMIT,
  DEFAULT_WORK_POLICIES,
  type EnqueueOptions,
  type JobQueue,
  type QueuePolicy,
  queuePolicyOf,
  type SingletonPolicy,
  type WorkOptions,
} from './index';

export type PgBossQueueOptions = {
  schema?: string;
  pollingIntervalSeconds?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
};

export function logPgBossError(error: unknown): void {
  console.error('pg-boss error', errorFields(error));
}

export function createPgBossQueue(databaseUrl: string, options: PgBossQueueOptions = {}): JobQueue {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    ...(options.schema ? { schema: options.schema } : {}),
  });
  boss.on('error', logPgBossError);
  const created = new Set<string>();

  const keyedName = (name: string, policy: SingletonPolicy = 'exclusive') =>
    policy === 'exclusive' ? `${name}.keyed` : `${name}.${policy}`;

  const QUEUES: Record<QueuePolicy, (name: string) => [string, SingletonPolicy | undefined]> = {
    plain: (name) => [name, undefined],
    keyed: (name) => [keyedName(name), 'exclusive'],
    stately: (name) => [keyedName(name, 'stately'), 'stately'],
  };

  async function ensureQueue(name: string, policy?: SingletonPolicy): Promise<void> {
    if (created.has(name)) return;
    await boss.createQueue(name, policy ? { policy } : undefined);
    created.add(name);
  }

  return {
    async start() {
      await boss.start();
    },
    async stop() {
      await boss.stop({ graceful: true });
    },
    async enqueue<T extends object>(name: string, data: T, opts: EnqueueOptions = {}) {
      const [target, policy] = QUEUES[queuePolicyOf(opts)](name);
      await ensureQueue(target, policy);
      await boss.send(target, data, {
        retryLimit: opts.retryLimit ?? DEFAULT_RETRY_LIMIT,
        ...(options.retryDelaySeconds === undefined
          ? {}
          : { retryDelay: options.retryDelaySeconds }),
        ...(options.retryBackoff === undefined ? {} : { retryBackoff: options.retryBackoff }),
        ...(opts.singletonKey === undefined ? {} : { singletonKey: opts.singletonKey }),
        ...(opts.startAfter === undefined ? {} : { startAfter: opts.startAfter }),
      });
    },
    async schedule(name, cron) {
      await ensureQueue(name);
      await boss.schedule(name, cron);
    },
    async work<T extends object>(
      name: string,
      handler: (data: T) => Promise<void>,
      opts: WorkOptions = {},
    ) {
      const run = async (jobs: { data: T }[]) => {
        for (const job of jobs) await handler(job.data);
      };
      const workOptions = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };
      for (const queuePolicy of new Set(opts.policies ?? DEFAULT_WORK_POLICIES)) {
        const [target, policy] = QUEUES[queuePolicy](name);
        await ensureQueue(target, policy);
        await boss.work<T>(target, workOptions, run);
      }
    },
  };
}
