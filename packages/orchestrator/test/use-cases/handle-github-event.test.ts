import { describe, expect, spyOn, test } from 'bun:test';
import { getInstallation, upsertInstallation } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { handleGitHubEvent, loadConfig, scanMemberSignals } from '../../src';
import { config, fakeDeps, seedOrg } from './fakes';

const INST = 21;

const VALID = `
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat: { provider: slack, channel: "#alpha" }
`;

const created = {
  action: 'created',
  installation: { id: INST, account: { id: 500, login: 'acme', type: 'Organization' } },
};

const push = (
  repo: string,
  ref: string,
  files: Partial<Record<'added' | 'modified' | 'removed', string[]>>,
) => ({
  ref,
  after: 'sha-after',
  repository: { name: repo, default_branch: 'main', owner: { login: 'acme' } },
  installation: { id: INST },
  commits: [{ added: [], modified: [], removed: [], ...files }],
});

const noGitHub = (deps: ReturnType<typeof fakeDeps>['deps']) => {
  deps.github.installationOctokit = async () => {
    throw new Error('no github in the webhook');
  };
};

const configJobs = (queue: { enqueued: { name: string; data: unknown }[] }) =>
  queue.enqueued.filter((j) => j.name === 'validate-config' || j.name === 'load-config');

useCleanDb();

describe('handleGitHubEvent', () => {
  test('installation created stores it and only enqueues a config load', async () => {
    const { deps, calls, queue } = fakeDeps({ source: { found: true, source: VALID } });
    noGitHub(deps);
    await handleGitHubEvent(deps, 'installation', created);
    const row = await getInstallation(db, INST);
    expect(row?.accountLogin).toBe('acme');
    expect(row?.accountType).toBe('Organization');
    expect(row?.accountId).toBe(500);
    expect(calls.config).toEqual([]);
    expect(queue.enqueued).toEqual([
      { name: 'load-config', data: { installationId: INST, owner: 'acme' } },
    ]);
  });

  test('the enqueued load-config job loads the config', async () => {
    const { deps, queue } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(deps, 'installation', created);
    await queue.work(
      'load-config',
      (data) => loadConfig(deps, data as { installationId: number; owner: string }),
      { policies: ['stately'] },
    );
    await queue.drain();
    expect((await getInstallation(db, INST))?.status).toBe('configured');
  });

  test('installation_repositories stores the account id and enqueues a config load', async () => {
    const { deps, queue } = fakeDeps({ source: { found: true, source: VALID } });
    noGitHub(deps);
    await handleGitHubEvent(deps, 'installation_repositories', { ...created, action: 'added' });
    expect((await getInstallation(db, INST))?.accountId).toBe(500);
    expect(queue.enqueued.map((j) => j.name)).toEqual(['load-config']);
  });

  test('installation deleted removes it', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, calls, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'installation', { ...created, action: 'deleted' });
    expect(await getInstallation(db, INST)).toBeNull();
    expect(calls.config).toEqual([]);
    expect(queue.enqueued).toEqual([]);
  });

  test('push touching standwise.yml on the default branch validates and loads', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, calls, queue } = fakeDeps({ source: { found: true, source: VALID } });
    noGitHub(deps);
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/main', { added: ['standwise.yml'] }),
    );
    expect(calls.config).toEqual([]);
    expect(configJobs(queue)).toEqual([
      {
        name: 'validate-config',
        data: { installationId: INST, owner: 'acme', headSha: 'sha-after' },
      },
      { name: 'load-config', data: { installationId: INST, owner: 'acme' } },
    ]);
  });

  test('push on a non-default branch validates but does not load', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, queue } = fakeDeps();
    noGitHub(deps);
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/feature', { modified: ['standwise.yml'] }),
    );
    expect(configJobs(queue)).toEqual([
      {
        name: 'validate-config',
        data: { installationId: INST, owner: 'acme', headSha: 'sha-after' },
      },
    ]);
  });

  test('a forced push with empty commits on the default branch validates and loads', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, queue } = fakeDeps();
    noGitHub(deps);
    await handleGitHubEvent(deps, 'push', {
      ...push('.github', 'refs/heads/main', {}),
      forced: true,
      commits: [],
    });
    expect(configJobs(queue).map((j) => j.name)).toEqual(['validate-config', 'load-config']);
  });

  test('a default branch push that does not touch the file still loads, without validating', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, queue } = fakeDeps();
    noGitHub(deps);
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/main', { modified: ['README.md'] }),
    );
    expect(configJobs(queue)).toEqual([
      { name: 'load-config', data: { installationId: INST, owner: 'acme' } },
    ]);
  });

  test('a forced push on another branch validates but does not load', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'push', {
      ...push('.github', 'refs/heads/dev', { modified: ['README.md'] }),
      forced: true,
    });
    expect(configJobs(queue).map((j) => j.name)).toEqual(['validate-config']);
  });

  test('push filters out other repos, owners, files, deletions and unknown installations', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, calls, queue } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(
      deps,
      'push',
      push('app', 'refs/heads/main', { modified: ['standwise.yml'] }),
    );
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/dev', { modified: ['README.md'] }),
    );
    const ownerless = push('.github', 'refs/heads/main', { modified: ['standwise.yml'] });
    await handleGitHubEvent(deps, 'push', {
      ...ownerless,
      repository: { name: '.github', default_branch: 'main' },
    });
    const foreign = push('.github', 'refs/heads/main', { modified: ['standwise.yml'] });
    await handleGitHubEvent(deps, 'push', {
      ...foreign,
      repository: { ...foreign.repository, owner: { login: 'evil' } },
    });
    await handleGitHubEvent(deps, 'push', {
      ...push('.github', 'refs/heads/main', { modified: ['standwise.yml'] }),
      deleted: true,
    });
    await handleGitHubEvent(deps, 'push', {
      ...push('.github', 'refs/heads/main', { modified: ['standwise.yml'] }),
      installation: { id: 404 },
    });
    expect(calls.config).toEqual([]);
    expect(queue.enqueued).toEqual([]);
  });

  test('pull_request on .github enqueues a validation of the head sha', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    for (const action of ['opened', 'synchronize', 'reopened']) {
      const { deps, queue, calls } = fakeDeps();
      noGitHub(deps);
      await handleGitHubEvent(deps, 'pull_request', {
        action,
        installation: { id: INST },
        repository: { name: '.github', owner: { login: 'acme' } },
        pull_request: { number: 4, head: { sha: 'pr-head' }, user: { login: 'carol' } },
      });
      expect(calls.listPullRequestFiles).toEqual([]);
      expect(configJobs(queue)).toEqual([
        {
          name: 'validate-config',
          data: { installationId: INST, owner: 'acme', headSha: 'pr-head', pullNumber: 4 },
        },
      ]);
    }
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request', {
      action: 'closed',
      installation: { id: INST },
      repository: { name: '.github', owner: { login: 'acme' } },
      pull_request: { number: 4, head: { sha: 'pr-head' }, user: { login: 'carol' } },
    });
    await handleGitHubEvent(deps, 'pull_request', {
      action: 'opened',
      installation: { id: INST },
      repository: { name: '.github', owner: { login: 'evil' } },
      pull_request: { number: 4, head: { sha: 'pr-head' }, user: { login: 'carol' } },
    });
    expect(configJobs(queue)).toEqual([]);
  });

  test('other events are ignored', async () => {
    const { deps, calls } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(deps, 'pull_request', created);
    expect(await getInstallation(db, INST)).toBeNull();
    expect(calls.config).toEqual([]);
  });
});

const pullRequest = (action: string, author: string, owner = 'acme') => ({
  action,
  installation: { id: INST },
  repository: { name: 'api', owner: { login: owner } },
  pull_request: { number: 7, user: { login: author } },
});

const checkSuite = (action: string, numbers: number[], owner = 'acme') => ({
  action,
  installation: { id: INST },
  repository: { name: 'api', owner: { login: owner } },
  check_suite: { pull_requests: numbers.map((number) => ({ number, head: { sha: 'abc' } })) },
});

const scans = (queue: { enqueued: { name: string; data: unknown }[] }) =>
  queue.enqueued.filter((j) => j.name === 'scan-member-signals').map((j) => j.data);

describe('handleGitHubEvent signal scans', () => {
  test('a pull_request_review for a member enqueues a scan for the PR author', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request_review', pullRequest('submitted', 'Alice'));
    expect(scans(queue)).toEqual([{ installationId: INST, login: 'alice' }]);
  });

  test('a non-member author is enqueued without GitHub calls and the scan job no-ops', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue, calls } = fakeDeps();
    let resolves = 0;
    const resolve = deps.github.resolveTeamMembers;
    deps.github.resolveTeamMembers = async (...args) => {
      resolves++;
      return resolve(...args);
    };
    const octokit = deps.github.installationOctokit;
    let octokits = 0;
    deps.github.installationOctokit = async (id) => {
      octokits++;
      return octokit(id);
    };
    await handleGitHubEvent(deps, 'pull_request_review', pullRequest('submitted', 'carol'));
    await handleGitHubEvent(deps, 'pull_request', pullRequest('opened', 'carol'));
    expect(resolves).toBe(0);
    expect(octokits).toBe(0);
    expect(scans(queue)).toEqual([{ installationId: INST, login: 'carol' }]);
    await queue.work(
      'scan-member-signals',
      (data) => scanMemberSignals(deps, data as { installationId: number; login: string }),
      { policies: ['stately'] },
    );
    await queue.drain();
    expect(calls.snapshots).toEqual([]);
  });

  test('pull_request actions that change signals enqueue a scan, others do not', async () => {
    await seedOrg(config(), { id: INST });
    for (const action of [
      'opened',
      'ready_for_review',
      'converted_to_draft',
      'synchronize',
      'closed',
      'reopened',
    ]) {
      const { deps, queue } = fakeDeps();
      await handleGitHubEvent(deps, 'pull_request', pullRequest(action, 'bob'));
      expect(scans(queue)).toEqual([{ installationId: INST, login: 'bob' }]);
    }
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request', pullRequest('labeled', 'bob'));
    await handleGitHubEvent(deps, 'pull_request_review', pullRequest('edited', 'bob'));
    expect(scans(queue)).toEqual([]);
  });

  test('a webhook scan waits 120 seconds on the stately member key and absorbs bursts', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue, setNow } = fakeDeps();
    const now = new Date('2026-10-28T12:00:00Z');
    setNow(now);
    const seen: unknown[] = [];
    const enqueue = queue.enqueue.bind(queue);
    deps.queue = {
      ...queue,
      enqueue: async (name, data, opts) => {
        if (name === 'scan-member-signals') seen.push(opts);
        return enqueue(name, data, opts);
      },
    };
    for (let i = 0; i < 3; i++) {
      await handleGitHubEvent(deps, 'pull_request', pullRequest('synchronize', 'alice'));
    }
    expect(seen[0]).toEqual({
      singletonKey: `scan:${INST}:alice`,
      policy: 'stately',
      startAfter: new Date(now.getTime() + 120_000),
    });
    expect(queue.enqueued.filter((j) => j.name === 'scan-member-signals')).toEqual([
      {
        name: 'scan-member-signals',
        data: { installationId: INST, login: 'alice' },
        startAfter: new Date(now.getTime() + 120_000),
      },
    ]);
  });

  test('a dismissed review enqueues a scan', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request_review', pullRequest('dismissed', 'alice'));
    expect(scans(queue)).toEqual([{ installationId: INST, login: 'alice' }]);
  });

  test('a repository of another owner or an unconfigured installation enqueues nothing', async () => {
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request', pullRequest('opened', 'alice'));
    await seedOrg(config(), { id: INST });
    await handleGitHubEvent(deps, 'pull_request', pullRequest('opened', 'alice', 'evil'));
    expect(scans(queue)).toEqual([]);
  });

  test('a completed check_suite only enqueues a resolve job, without GitHub calls', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue, calls } = fakeDeps();
    let resolves = 0;
    deps.github.resolveTeamMembers = async (_o, _owner, members) => {
      resolves++;
      return members;
    };
    deps.github.installationOctokit = async () => {
      throw new Error('no github in the webhook');
    };
    await handleGitHubEvent(deps, 'check_suite', checkSuite('completed', [1, 2, 3, 4, 5, 6, 7]));
    expect(calls.getPullRequest).toEqual([]);
    expect(resolves).toBe(0);
    expect(queue.enqueued).toEqual([
      {
        name: 'resolve-check-suite',
        data: { installationId: INST, owner: 'acme', repo: 'api', numbers: [1, 2, 3, 4, 5] },
      },
    ]);
  });

  test('check_suite skips foreign repos, other actions and empty PR lists', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'check_suite', checkSuite('completed', [1], 'evil'));
    await handleGitHubEvent(deps, 'check_suite', checkSuite('requested', [1]));
    await handleGitHubEvent(deps, 'check_suite', checkSuite('completed', []));
    expect(queue.enqueued).toEqual([]);
  });

  test('a failure while enqueueing the scan is logged and does not throw', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue } = fakeDeps();
    deps.queue.enqueue = async () => {
      throw new Error('queue down');
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await handleGitHubEvent(deps, 'pull_request', pullRequest('opened', 'alice'));
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('queue down');
    expect(scans(queue)).toEqual([]);
  });
});
