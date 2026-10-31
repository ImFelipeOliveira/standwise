export type SingletonPolicy = 'exclusive' | 'stately';

export type EnqueueOptions = {
  singletonKey?: string;
  policy?: SingletonPolicy;
  startAfter?: Date;
  retryLimit?: number;
};

export type QueuePolicy = 'plain' | 'keyed' | 'stately';

export type WorkOptions = { policies?: readonly QueuePolicy[] };

export const DEFAULT_WORK_POLICIES: readonly QueuePolicy[] = ['plain'];

export function queuePolicyOf(opts: EnqueueOptions): QueuePolicy {
  if (opts.singletonKey === undefined) return 'plain';
  return opts.policy === 'stately' ? 'stately' : 'keyed';
}

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue<T extends object>(name: string, data: T, opts?: EnqueueOptions): Promise<void>;
  schedule(name: string, cron: string): Promise<void>;
  work<T extends object>(
    name: string,
    handler: (data: T) => Promise<void>,
    opts?: WorkOptions,
  ): Promise<void>;
}

export const DEFAULT_RETRY_LIMIT = 3;

export { createMemoryQueue } from './memory';
export { createPgBossQueue, logPgBossError, type PgBossQueueOptions } from './pgboss';
