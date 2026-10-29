import { PgBoss } from 'pg-boss';
import { DEFAULT_RETRY_LIMIT, type EnqueueOptions, type JobQueue } from './index';

export type PgBossQueueOptions = {
  schema?: string;
  pollingIntervalSeconds?: number;
  retryDelaySeconds?: number;
};

export function createPgBossQueue(databaseUrl: string, options: PgBossQueueOptions = {}): JobQueue {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    ...(options.schema ? { schema: options.schema } : {}),
  });
  boss.on('error', (error) => console.error('pg-boss error', error));
  const created = new Set<string>();

  const keyedName = (name: string) => `${name}.keyed`;

  async function ensureQueue(name: string, policy?: 'exclusive'): Promise<void> {
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
      const target = opts.singletonKey === undefined ? name : keyedName(name);
      await ensureQueue(target, opts.singletonKey === undefined ? undefined : 'exclusive');
      await boss.send(target, data, {
        retryLimit: opts.retryLimit ?? DEFAULT_RETRY_LIMIT,
        ...(options.retryDelaySeconds === undefined
          ? {}
          : { retryDelay: options.retryDelaySeconds }),
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
      const run = async (jobs: { data: T }[]) => {
        for (const job of jobs) await handler(job.data);
      };
      const workOptions = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };
      await boss.work<T>(name, workOptions, run);
      await boss.work<T>(keyedName(name), workOptions, run);
    },
  };
}
