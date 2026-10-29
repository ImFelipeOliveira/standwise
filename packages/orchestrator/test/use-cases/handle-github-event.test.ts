import { describe, expect, test } from 'bun:test';
import { getInstallation, upsertInstallation } from '@standwise/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { handleGitHubEvent } from '../../src';
import { fakeDeps } from './fakes';

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
