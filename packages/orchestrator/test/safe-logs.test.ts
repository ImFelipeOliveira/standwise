import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { getMemberById, insertWebhookEndpoint, listOverdueWebhookDeliveries } from '@standwise/db';
import { db, useCleanDb } from '../../db/test/setup';
import {
  deliverWebhook,
  emitEvent,
  emitEventSafely,
  errorFields,
  linkChatIdentities,
} from '../src';
import { fakeDeps, seedMember, seedOrg } from './use-cases/fakes';

useCleanDb();

const SECRET_TEXT = 'my private daily text 8c1f';
const KEY = new Uint8Array(32).fill(7);

let logged: unknown[][] = [];

beforeEach(() => {
  logged = [];
  spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  (console.error as unknown as { mockRestore: () => void }).mockRestore();
});

function leaky(): Error {
  return Object.assign(new Error(`Failed query: insert into dailies\nparams: ${SECRET_TEXT}`), {
    code: '23505',
    params: [SECRET_TEXT],
    query: SECRET_TEXT,
    cause: new Error(SECRET_TEXT),
  });
}

function captured(): string {
  return JSON.stringify(logged, (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v));
}

const event = {
  type: 'daily.submitted' as const,
  data: {
    id: 'd1',
    login: 'alice',
    date: '2026-10-28',
    teams: ['backend'],
    yesterday: [{ text: SECRET_TEXT }],
    today: [],
    blockers: [],
    replaced: false,
  },
};

describe('errorFields', () => {
  test('keeps name, code and message only and drops drizzle params', () => {
    const fields = errorFields(leaky());
    expect(Object.keys(fields).sort()).toEqual(['code', 'message', 'name']);
    expect(JSON.stringify(fields)).not.toContain(SECRET_TEXT);
    expect(fields.code).toBe('23505');
  });

  test('a real drizzle failure does not leak its params', async () => {
    const error = await getMemberById(db, SECRET_TEXT).catch((e: unknown) => e);
    expect(String((error as Error).message)).toContain(SECRET_TEXT);
    expect(JSON.stringify(errorFields(error))).not.toContain(SECRET_TEXT);
  });
});

describe('safe logging', () => {
  test('emitEventSafely logs only name, code and message', async () => {
    await seedOrg();
    await insertWebhookEndpoint(
      db,
      {
        installationId: 11,
        url: 'https://hooks.example.com/x',
        events: ['daily.submitted'],
        secret: 's',
      },
      KEY,
    );
    const { deps, queue } = fakeDeps();
    queue.enqueue = async () => {
      throw leaky();
    };
    await emitEventSafely(deps, 11, event);
    expect(logged).toHaveLength(1);
    expect(captured()).not.toContain(SECRET_TEXT);
  });

  test('deliverWebhook logs an unexpected attempt failure without its payload', async () => {
    await seedOrg();
    await insertWebhookEndpoint(
      db,
      {
        installationId: 11,
        url: 'https://hooks.example.com/x',
        events: ['daily.submitted'],
        secret: 's',
      },
      KEY,
    );
    const { deps, queue } = fakeDeps();
    await emitEvent({ ...deps, queue }, 11, event);
    const ids = await listOverdueWebhookDeliveries(db, new Date('2030-01-01T00:00:00Z'), 10);
    expect(ids).toHaveLength(1);
    await deliverWebhook(
      {
        ...deps,
        encryptionKey: KEY,
        webhookTransport: {
          get resolve(): never {
            throw leaky();
          },
        },
      },
      { deliveryId: ids[0] as string },
    );
    expect(logged.length).toBeGreaterThan(0);
    expect(captured()).not.toContain(SECRET_TEXT);
  });

  test('linkChatIdentities logs a failed link instead of swallowing it', async () => {
    await seedOrg();
    const member = await seedMember();
    const { deps } = fakeDeps({ findUserError: leaky() });
    await linkChatIdentities(deps, member.id, 'alice@acme.com', [11]);
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toBe('chat identity link failed');
    expect(captured()).not.toContain(SECRET_TEXT);
  });
});
