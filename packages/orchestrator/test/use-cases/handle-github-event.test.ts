import { describe, expect, spyOn, test } from 'bun:test';
import { getInstallation, upsertInstallation } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { handleGitHubEvent } from '../../src';
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
  repository: { name: repo, default_branch: 'main' },
  installation: { id: INST },
  commits: [{ added: [], modified: [], removed: [], ...files }],
});

useCleanDb();

describe('handleGitHubEvent', () => {
  test('installation created stores it and loads config', async () => {
    const { deps, calls } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(deps, 'installation', created);
    const row = await getInstallation(db, INST);
    expect(row?.accountLogin).toBe('acme');
    expect(row?.accountType).toBe('Organization');
    expect(row?.accountId).toBe(500);
    expect(row?.status).toBe('configured');
    expect(calls.config).toEqual(['acme']);
  });

  test('installation_repositories stores the account id', async () => {
    const { deps } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(deps, 'installation_repositories', { ...created, action: 'added' });
    expect((await getInstallation(db, INST))?.accountId).toBe(500);
  });

  test('installation deleted removes it', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, calls } = fakeDeps();
    await handleGitHubEvent(deps, 'installation', { ...created, action: 'deleted' });
    expect(await getInstallation(db, INST)).toBeNull();
    expect(calls.config).toEqual([]);
  });

  test('push touching standwise.yml on the default branch of .github reloads config', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, calls } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/main', { added: ['standwise.yml'] }),
    );
    expect(calls.config).toEqual(['acme']);
    expect((await getInstallation(db, INST))?.status).toBe('configured');
  });

  test('push filters out other repos, branches, files and unknown installations', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const { deps, calls } = fakeDeps({ source: { found: true, source: VALID } });
    await handleGitHubEvent(
      deps,
      'push',
      push('app', 'refs/heads/main', { modified: ['standwise.yml'] }),
    );
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/dev', { modified: ['standwise.yml'] }),
    );
    await handleGitHubEvent(
      deps,
      'push',
      push('.github', 'refs/heads/main', { modified: ['README.md'] }),
    );
    await handleGitHubEvent(deps, 'push', {
      ...push('.github', 'refs/heads/main', { modified: ['standwise.yml'] }),
      installation: { id: 404 },
    });
    expect(calls.config).toEqual([]);
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

  test('a pull_request_review for a non-member enqueues nothing', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request_review', pullRequest('submitted', 'carol'));
    expect(scans(queue)).toEqual([]);
  });

  test('pull_request actions that change signals enqueue a scan, others do not', async () => {
    await seedOrg(config(), { id: INST });
    for (const action of ['opened', 'ready_for_review', 'synchronize', 'closed', 'reopened']) {
      const { deps, queue } = fakeDeps();
      await handleGitHubEvent(deps, 'pull_request', pullRequest(action, 'bob'));
      expect(scans(queue)).toEqual([{ installationId: INST, login: 'bob' }]);
    }
    const { deps, queue } = fakeDeps();
    await handleGitHubEvent(deps, 'pull_request', pullRequest('labeled', 'bob'));
    await handleGitHubEvent(deps, 'pull_request_review', pullRequest('edited', 'bob'));
    expect(scans(queue)).toEqual([]);
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

  test('a GitHub failure while resolving members is logged and does not throw', async () => {
    await seedOrg(config(), { id: INST });
    const { deps, queue } = fakeDeps();
    deps.github.resolveTeamMembers = async () => {
      throw new Error('github down');
    };
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    await handleGitHubEvent(deps, 'pull_request', pullRequest('opened', 'alice'));
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('github down');
    expect(scans(queue)).toEqual([]);
  });
});
