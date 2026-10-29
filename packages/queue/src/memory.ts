import { DEFAULT_RETRY_LIMIT, type EnqueueOptions, type JobQueue } from './index';

type Handler = (data: object) => Promise<void>;
type Job = { name: string; data: object; retryLimit: number; attempts: number; key?: string };

export type MemoryQueue = JobQueue & {
  /** Runs every pending job, including retries, until none remain. */
  drain(): Promise<void>;
  enqueued: { name: string; data: object }[];
  scheduled: { name: string; cron: string }[];
};

export function createMemoryQueue(): MemoryQueue {
  const handlers = new Map<string, Handler>();
  const pending: Job[] = [];
  const claimedKeys = new Set<string>();
  const enqueued: { name: string; data: object }[] = [];
  const scheduled: { name: string; cron: string }[] = [];

  return {
    enqueued,
    scheduled,
    async start() {},
    async stop() {},
    async enqueue<T extends object>(name: string, data: T, opts: EnqueueOptions = {}) {
      const key = opts.singletonKey === undefined ? undefined : `${name}:${opts.singletonKey}`;
      if (key !== undefined) {
        if (claimedKeys.has(key)) return;
        claimedKeys.add(key);
      }
      enqueued.push({ name, data });
      pending.push({
        name,
        data,
        retryLimit: opts.retryLimit ?? DEFAULT_RETRY_LIMIT,
        attempts: 0,
        key,
      });
    },
    async schedule(name, cron) {
      scheduled.push({ name, cron });
    },
    async work<T extends object>(name: string, handler: (data: T) => Promise<void>) {
      handlers.set(name, handler as Handler);
    },
    async drain() {
      // Jobs without a registered handler stay pending until one is registered.
      const waiting: Job[] = [];
      for (let job = pending.shift(); job; job = pending.shift()) {
        const handler = handlers.get(job.name);
        if (!handler) {
          waiting.push(job);
          continue;
        }
        job.attempts++;
        try {
          await handler(job.data);
        } catch {
          if (job.attempts <= job.retryLimit) pending.push(job);
        }
      }
      pending.push(...waiting);
      // Keys stay claimed only for jobs that are still queued.
      claimedKeys.clear();
      for (const job of pending) if (job.key) claimedKeys.add(job.key);
    },
  };
}
