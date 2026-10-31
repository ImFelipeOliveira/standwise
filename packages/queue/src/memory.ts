import {
  DEFAULT_RETRY_LIMIT,
  DEFAULT_WORK_POLICIES,
  type EnqueueOptions,
  type JobQueue,
  type QueuePolicy,
  queuePolicyOf,
  type WorkOptions,
} from './index';

type Handler = (data: object) => Promise<void>;
type Worker = { handler: Handler; policies: readonly QueuePolicy[] };
type Job = {
  name: string;
  policy: QueuePolicy;
  data: object;
  retryLimit: number;
  attempts: number;
  key?: string;
  statelyKey?: string;
};

type Enqueued = { name: string; data: object; startAfter?: Date };

export type MemoryQueue = JobQueue & {
  drain(): Promise<void>;
  enqueued: Enqueued[];
  scheduled: { name: string; cron: string }[];
};

export function createMemoryQueue(): MemoryQueue {
  const workers = new Map<string, Worker>();
  const pending: Job[] = [];
  const inFlightKeys = new Set<string>();
  const enqueued: Enqueued[] = [];
  const scheduled: { name: string; cron: string }[] = [];

  return {
    enqueued,
    scheduled,
    async start() {},
    async stop() {},
    async enqueue<T extends object>(name: string, data: T, opts: EnqueueOptions = {}) {
      const scoped = opts.singletonKey === undefined ? undefined : `${name}:${opts.singletonKey}`;
      const statelyKey = opts.policy === 'stately' ? scoped : undefined;
      const key = opts.policy === 'stately' ? undefined : scoped;
      if (statelyKey !== undefined && pending.some((job) => job.statelyKey === statelyKey)) return;
      if (key !== undefined) {
        if (inFlightKeys.has(key)) return;
        inFlightKeys.add(key);
      }
      enqueued.push(
        opts.startAfter === undefined
          ? { name, data }
          : { name, data, startAfter: opts.startAfter },
      );
      pending.push({
        name,
        policy: queuePolicyOf(opts),
        data,
        retryLimit: opts.retryLimit ?? DEFAULT_RETRY_LIMIT,
        attempts: 0,
        key,
        statelyKey,
      });
    },
    async schedule(name, cron) {
      scheduled.push({ name, cron });
    },
    async work<T extends object>(
      name: string,
      handler: (data: T) => Promise<void>,
      opts: WorkOptions = {},
    ) {
      workers.set(name, {
        handler: handler as Handler,
        policies: opts.policies ?? DEFAULT_WORK_POLICIES,
      });
    },
    async drain() {
      const waiting: Job[] = [];
      for (let job = pending.shift(); job; job = pending.shift()) {
        const worker = workers.get(job.name);
        const handler = worker?.policies.includes(job.policy) ? worker.handler : undefined;
        if (!handler) {
          waiting.push(job);
          continue;
        }
        job.attempts++;
        let retrying = false;
        try {
          await handler(job.data);
        } catch {
          retrying = job.attempts <= job.retryLimit;
          if (retrying) pending.push(job);
        }
        if (!retrying && job.key) inFlightKeys.delete(job.key);
      }
      pending.push(...waiting);
    },
  };
}
