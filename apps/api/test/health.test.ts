import { describe, expect, test } from 'bun:test';
import type { Deps } from '@standwise/orchestrator';
import { db } from '../../../packages/db/test/setup';
import { gracefulShutdown } from '../src/shutdown';
import { createTestApp } from './support';

function downDb(): Deps['db'] {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return async () => {
          throw new Error('connection refused');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe('health', () => {
  test('is ok while the database answers', async () => {
    const { app } = createTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('is 503 when the database is down', async () => {
    const { app } = createTestApp({ db: downDb() });
    const res = await app.request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  test('is 503 within the bound when the database never answers', async () => {
    const hanging = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'execute') return () => new Promise(() => {});
        return Reflect.get(target, prop, receiver);
      },
    }) as Deps['db'];
    const { app } = createTestApp({ db: hanging, healthTimeoutMs: 50 });
    const started = Date.now();
    const res = await app.request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(Date.now() - started).toBeLessThan(2500);
  });

  test('does not pile up probes while a query is still running', async () => {
    let calls = 0;
    const hanging = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'execute') {
          return () => {
            calls++;
            return new Promise(() => {});
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Deps['db'];
    const { app } = createTestApp({ db: hanging, healthTimeoutMs: 20 });
    const first = await app.request('/health');
    const second = await app.request('/health');
    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(await second.json()).toEqual({ ok: false });
    expect(calls).toBe(1);
  });

  test('documents the 503 response', async () => {
    const { app } = createTestApp();
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    expect(Object.keys(doc.paths['/health']?.get?.responses ?? {})).toEqual(['200', '503']);
  });
});

describe('gracefulShutdown', () => {
  test('stops the server, then the queue, then exits once', async () => {
    const steps: string[] = [];
    const shutdown = gracefulShutdown({
      server: {
        stop: async () => {
          steps.push('server');
        },
      },
      queue: {
        stop: async () => {
          steps.push('queue');
        },
      },
      exit: (code) => steps.push(`exit ${code}`),
    });
    await Promise.all([shutdown(), shutdown()]);
    expect(steps).toEqual(['server', 'queue', 'exit 0']);
  });

  test('exits with an error code when stopping fails', async () => {
    const steps: string[] = [];
    const shutdown = gracefulShutdown({
      server: { stop: async () => steps.push('server') },
      queue: {
        stop: async () => {
          throw new Error('boom');
        },
      },
      exit: (code) => steps.push(`exit ${code}`),
      log: () => steps.push('logged'),
    });
    await shutdown();
    expect(steps).toEqual(['server', 'logged', 'exit 1']);
  });
});
