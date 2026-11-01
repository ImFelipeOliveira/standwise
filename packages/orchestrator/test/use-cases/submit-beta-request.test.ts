import { describe, expect, test } from 'bun:test';
import { deleteBetaRequestsCreatedBefore } from '@standcast/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { DomainError, NOTIFY_BETA_REQUEST_JOB, submitBetaRequest } from '../../src';
import { fakeDeps } from './fakes';

useCleanDb();

const form = (extra: Record<string, unknown> = {}) => ({
  name: ' Ana ',
  email: 'Ana@Acme.com',
  team_size: '6-15',
  chat: 'slack',
  tracker: 'linear',
  locale: 'en',
  company_website: '',
  ...extra,
});

async function rowCount(): Promise<number> {
  return deleteBetaRequestsCreatedBefore(db, new Date('2100-01-01T00:00:00Z'));
}

describe('submitBetaRequest', () => {
  test('stores and enqueues once', async () => {
    const { deps, queue } = fakeDeps();
    const result = await submitBetaRequest(deps, form());
    expect(result).toEqual({ outcome: 'stored', locale: 'en' });
    expect(await rowCount()).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.name).toBe(NOTIFY_BETA_REQUEST_JOB);
    expect(queue.enqueued[0]?.data).toEqual({ requestId: expect.any(String) });
    expect(queue.enqueued[0]?.startAfter).toBeUndefined();
  });

  test('duplicate within 24h', async () => {
    const { deps, queue } = fakeDeps();
    await submitBetaRequest(deps, form());
    const again = await submitBetaRequest(deps, form({ email: ' ana@acme.com ' }));
    expect(again.outcome).toBe('duplicate');
    expect(await rowCount()).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  test('name with a newline is rejected', async () => {
    const { deps, queue } = fakeDeps();
    await expect(
      submitBetaRequest(deps, form({ name: 'Ana\r\nBcc: x@evil.com' })),
    ).rejects.toMatchObject({ code: 'invalid_beta_request' });
    expect(await rowCount()).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  test('honeypot filled', async () => {
    const { deps, queue } = fakeDeps();
    const result = await submitBetaRequest(
      deps,
      form({ company_website: 'http://spam', tracker: 'x' }),
    );
    expect(result.outcome).toBe('spam');
    expect(await rowCount()).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  test('missing tracker', async () => {
    const { deps, queue } = fakeDeps();
    const { tracker: _tracker, ...rest } = form();
    await expect(submitBetaRequest(deps, rest)).rejects.toMatchObject({
      code: 'invalid_beta_request',
      message: 'invalid beta request',
    });
    expect(queue.enqueued).toHaveLength(0);
  });

  test('locale pt-BR carried on error', async () => {
    const { deps } = fakeDeps();
    const error = await submitBetaRequest(deps, form({ locale: 'pt-BR', email: 'nope' })).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect(error.details).toEqual({ locale: 'pt-BR' });
  });

  test('unknown locale falls back to en', async () => {
    const { deps } = fakeDeps();
    const result = await submitBetaRequest(deps, form({ locale: 'fr' }));
    expect(result.locale).toBe('en');
  });

  test('array values are invalid', async () => {
    const { deps } = fakeDeps();
    await expect(submitBetaRequest(deps, form({ name: ['a', 'b'] }))).rejects.toMatchObject({
      code: 'invalid_beta_request',
    });
  });

  test('name over 120 chars rejected', async () => {
    const { deps } = fakeDeps();
    await expect(submitBetaRequest(deps, form({ name: 'a'.repeat(121) }))).rejects.toMatchObject({
      code: 'invalid_beta_request',
    });
    expect((await submitBetaRequest(deps, form({ name: 'a'.repeat(120) }))).outcome).toBe('stored');
  });
});
