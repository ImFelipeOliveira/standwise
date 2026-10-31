import { describe, expect, spyOn, test } from 'bun:test';
import { useCleanDb } from '../../../db/test/setup';
import { resolveCheckSuite } from '../../src';
import { config, fakeDeps, INST, seedOrg } from './fakes';

useCleanDb();

const detail = (number: number, author: string) => ({
  ref: { owner: 'acme', repo: 'api', number },
  url: `https://github.com/acme/api/pull/${number}`,
  title: `PR ${number}`,
  author,
  state: 'open' as const,
  draft: false,
  headSha: 'abc',
  baseRef: 'main',
  requestedReviewers: [],
  requestedTeams: [],
});

const scans = (queue: { enqueued: { name: string; data: unknown }[] }) =>
  queue.enqueued.filter((j) => j.name === 'scan-member-signals').map((j) => j.data);

const job = (numbers: number[], owner = 'acme') => ({
  installationId: INST,
  owner,
  repo: 'api',
  numbers,
});

describe('resolveCheckSuite', () => {
  test('looks up each PR author and enqueues a scan for members only', async () => {
    await seedOrg();
    const { deps, queue, calls } = fakeDeps({
      pulls: {
        'acme/api#1': detail(1, 'Alice'),
        'acme/api#2': detail(2, 'carol'),
        'acme/api#4': detail(4, 'alice'),
      },
    });
    await resolveCheckSuite(deps, job([1, 2, 3, 4]));
    expect(calls.getPullRequest).toEqual(['acme/api#1', 'acme/api#2', 'acme/api#3', 'acme/api#4']);
    expect(scans(queue)).toEqual([{ installationId: INST, login: 'alice' }]);
  });

  test('caps lookups at five', async () => {
    await seedOrg();
    const { deps, calls } = fakeDeps();
    await resolveCheckSuite(deps, job([1, 2, 3, 4, 5, 6, 7]));
    expect(calls.getPullRequest).toHaveLength(5);
  });

  test('skips foreign owners and unconfigured installations', async () => {
    const { deps, calls } = fakeDeps();
    await resolveCheckSuite(deps, job([1]));
    await seedOrg(config());
    await resolveCheckSuite(deps, job([1], 'evil'));
    expect(calls.getPullRequest).toEqual([]);
  });

  test('a failed lookup is logged, the others still enqueue, and the job throws to retry', async () => {
    await seedOrg();
    const fake = fakeDeps({ pulls: { 'acme/api#2': detail(2, 'bob') } });
    const original = fake.deps.github.getPullRequest;
    fake.deps.github.getPullRequest = async (o, ref) => {
      if (ref.number === 1) throw Object.assign(new Error('github down'), { code: 'E500' });
      return original(o, ref);
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await expect(resolveCheckSuite(fake.deps, job([1, 2]))).rejects.toThrow('github down');
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('E500');
    expect(scans(fake.queue)).toEqual([{ installationId: INST, login: 'bob' }]);
  });
});
