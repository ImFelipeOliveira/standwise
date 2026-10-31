import { expect, test } from 'bun:test';
import { createLinearClient, listCardActivity, listStaleInProgress } from '../src';
import { fakeFetch, fixture } from './helpers';

const since = new Date('2026-10-29T00:00:00.000Z');

test('classifies done, started and drops the rest', async () => {
  const f = fakeFetch({ body: fixture('activity.json') });
  const items = await listCardActivity(createLinearClient('t', f.fetch), {
    userId: 'u1',
    teamKey: 'ENG',
    since,
  });
  expect(items).toEqual([
    {
      kind: 'card_done',
      title: 'Done one',
      url: 'https://linear.app/acme/issue/ENG-1',
      repo: 'ENG',
      at: new Date('2026-10-30T09:00:00.000Z'),
    },
    {
      kind: 'card_started',
      title: 'Started one',
      url: 'https://linear.app/acme/issue/ENG-2',
      repo: 'ENG',
      at: new Date('2026-10-29T10:00:00.000Z'),
    },
  ]);
});

test('activity inputs go through variables with first 50', async () => {
  const f = fakeFetch({ body: fixture('activity.json') });
  await listCardActivity(createLinearClient('t', f.fetch), {
    userId: 'u1',
    teamKey: 'ENG',
    since,
  });
  const sent = JSON.parse(f.calls[0]?.body ?? '');
  expect(sent.variables).toEqual({
    userId: 'u1',
    teamKey: 'ENG',
    since: '2026-10-29T00:00:00.000Z',
  });
  expect(sent.query).toContain('first: 50');
  expect(sent.query).not.toContain('u1');
  expect(sent.query).not.toContain('ENG');
});

test('stale list drops issues without startedAt and malformed nodes', async () => {
  const f = fakeFetch({ body: fixture('stale.json') });
  const cards = await listStaleInProgress(createLinearClient('t', f.fetch), {
    userId: 'u1',
    teamKey: 'ENG',
  });
  expect(cards).toEqual([
    {
      id: 'a',
      identifier: 'ENG-1',
      url: 'https://linear.app/acme/issue/ENG-1',
      title: 'Slow',
      startedAt: new Date('2026-10-01T10:00:00.000Z'),
    },
  ]);
  const sent = JSON.parse(f.calls[0]?.body ?? '');
  expect(sent.variables).toEqual({ userId: 'u1', teamKey: 'ENG' });
  expect(sent.query).toContain('"started"');
  expect(sent.query).toContain('first: 50');
});

test('every request goes to api.linear.app only', async () => {
  const f = fakeFetch({ body: fixture('activity.json') });
  const client = createLinearClient('t', f.fetch);
  await listCardActivity(client, { userId: 'u', teamKey: 'ENG', since });
  await listStaleInProgress(client, { userId: 'u', teamKey: 'ENG' });
  expect(f.calls.length).toBe(2);
  for (const c of f.calls) expect(c.url.host).toBe('api.linear.app');
});
