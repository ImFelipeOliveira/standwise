export type EnqueueOptions = {
  singletonKey?: string;
  startAfter?: Date;
  retryLimit?: number;
};

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue<T extends object>(name: string, data: T, opts?: EnqueueOptions): Promise<void>;
  schedule(name: string, cron: string): Promise<void>;
  work<T extends object>(name: string, handler: (data: T) => Promise<void>): Promise<void>;
}

export const DEFAULT_RETRY_LIMIT = 3;

export { createMemoryQueue } from './memory';
export { createPgBossQueue, type PgBossQueueOptions } from './pgboss';
