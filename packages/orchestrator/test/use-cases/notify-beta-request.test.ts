import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { getBetaRequest, upsertBetaRequest } from '@standcast/db';
import type { EmailMessage } from '@standcast/resend';
import { db, useCleanDb } from '../../../db/test/setup';
import { notifyBetaRequest, type WorkerDeps } from '../../src';

useCleanDb();

const NOW = new Date('2026-11-01T12:00:00Z');
const EMAIL = 'ana@acme.com';

async function seed(): Promise<string> {
  const stored = await upsertBetaRequest(
    db,
    {
      name: 'Ana Souza',
      email: EMAIL,
      teamSize: '6-15',
      chat: 'slack',
      tracker: 'linear',
      locale: 'pt-BR',
    },
    NOW,
  );
  if (!stored) throw new Error('seed failed');
  return stored.id;
}

function build(send?: (m: EmailMessage) => Promise<void>) {
  const sent: EmailMessage[] = [];
  const deps: Pick<WorkerDeps, 'db' | 'now' | 'email' | 'env'> = {
    db,
    now: () => NOW,
    email: {
      send: async (m) => {
        sent.push(m);
        if (send) await send(m);
      },
    },
    env: {
      linearClientId: 'lid',
      linearClientSecret: 'lsecret',
      supportEmail: 'support@sw.test',
      betaEmailFrom: 'Standcast <beta@sw.test>',
    },
  };
  return { deps, sent };
}

let logged: unknown[][] = [];
let spy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logged = [];
  spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  spy.mockRestore();
});

describe('notifyBetaRequest', () => {
  test('sends once and marks', async () => {
    const id = await seed();
    const { deps, sent } = build();
    await notifyBetaRequest(deps, { requestId: id });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Standcast <beta@sw.test>',
      to: 'support@sw.test',
      replyTo: EMAIL,
      subject: 'Beta request: Ana Souza (6-15, slack, linear)',
    });
    expect(sent[0]?.text).toContain('pt-BR');
    expect(sent[0]?.text).toContain(EMAIL);
    expect(sent[0]?.text).toContain('Ana Souza');
    expect((await getBetaRequest(db, id))?.notifiedAt).toEqual(NOW);
    await notifyBetaRequest(deps, { requestId: id });
    expect(sent).toHaveLength(1);
  });

  test('missing row sends nothing', async () => {
    const { deps, sent } = build();
    await notifyBetaRequest(deps, { requestId: '00000000-0000-4000-8000-000000000000' });
    expect(sent).toHaveLength(0);
  });

  test('already notified', async () => {
    const id = await seed();
    const { deps, sent } = build();
    await notifyBetaRequest(deps, { requestId: id });
    sent.length = 0;
    await notifyBetaRequest(deps, { requestId: id });
    expect(sent).toHaveLength(0);
  });

  test('email disabled', async () => {
    const id = await seed();
    const { deps, sent } = build();
    deps.email = null;
    await notifyBetaRequest(deps, { requestId: id });
    expect(sent).toHaveLength(0);
    expect((await getBetaRequest(db, id))?.notifiedAt).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe('beta email disabled');
  });

  test('send failure rethrows and leaves unmarked', async () => {
    const id = await seed();
    const { deps } = build(async () => {
      throw new Error('boom');
    });
    await expect(notifyBetaRequest(deps, { requestId: id })).rejects.toThrow('boom');
    expect((await getBetaRequest(db, id))?.notifiedAt).toBeNull();
  });

  test('log never contains the requester email', async () => {
    const id = await seed();
    const disabled = build();
    disabled.deps.email = null;
    await notifyBetaRequest(disabled.deps, { requestId: id });
    expect(JSON.stringify(logged)).not.toContain(EMAIL);
    expect(JSON.stringify(logged)).not.toContain('Ana');
  });
});
