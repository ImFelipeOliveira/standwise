import { PgBoss } from 'pg-boss';
import {
  DEFAULT_RETRY_LIMIT,
  type EnqueueOptions,
  type JobQueue,
  type SingletonPolicy,
} from './index';

export type PgBossQueueOptions = {
  schema?: string;
  pollingIntervalSeconds?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
};

export function createPgBossQueue(databaseUrl: string, options: PgBossQueueOptions = {}): JobQueue {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    ...(options.schema ? { schema: options.schema } : {}),
  });
  boss.on('error', (error) => console.error('pg-boss error', error));
  const created = new Set<string>();

  const keyedName = (name: string, policy: SingletonPolicy = 'exclusive') =>
    policy === 'exclusive' ? `${name}.keyed` : `${name}.${policy}`;

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
      const policy = opts.singletonKey === undefined ? undefined : (opts.policy ?? 'exclusive');
      const target = policy === undefined ? name : keyedName(name, policy);
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
    async work<T extends object>(name: string, handler: (data: T) => Promise<void>) {
      await ensureQueue(name);
      await ensureQueue(keyedName(name), 'exclusive');
      await ensureQueue(keyedName(name, 'stately'), 'stately');
      const run = async (jobs: { data: T }[]) => {
        for (const job of jobs) await handler(job.data);
      };
      const workOptions = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };
      await boss.work<T>(name, workOptions, run);
      await boss.work<T>(keyedName(name), workOptions, run);
      await boss.work<T>(keyedName(name, 'stately'), workOptions, run);
    },
  };
}
