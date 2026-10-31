import { describe, expect, test } from 'bun:test';
import { Webhooks } from '@octokit/webhooks';
import { parseConfig } from '@standwise/core';
import { getInstallation, setInstallationConfig, upsertInstallation } from '@standwise/db';
import { type Deps, loadConfig, nullTracker } from '@standwise/orchestrator';
import { createMemoryQueue } from '@standwise/queue';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import { createApp } from '../src/app';

const SECRET = 'whsec';
const signer = new Webhooks({ secret: SECRET });
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

type Source = Awaited<ReturnType<Deps['github']['fetchConfigSource']>>;

function harness(source: Source) {
  const calls: string[] = [];
  const queue = createMemoryQueue();
  const deps: Deps = {
    db,
    queue,
    now: () => new Date('2026-10-28T15:00:00Z'),
    encryptionKey: new Uint8Array(32).fill(7),
    github: {
      app: {} as Deps['github']['app'],
      installationOctokit: async () => ({}) as never,
      getUserProfile: async () => {
        throw new Error('unused');
      },
      listActivity: async () => [],
      resolveTeamMembers: async (_o, _owner, members) => members,
      getPullRequest: async () => null,
      listPullRequestFiles: async () => [],
      listOpenPullRequestSnapshots: async () => [],
      fetchCodeowners: async () => null,
      createCheckRun: async () => {},
      fetchConfigSource: async (_o, owner) => {
        calls.push(owner);
        return source;
      },
      exchangeWebCode: async () => {
        throw new Error('unused');
      },
    },
    slack: {
      exchangeCode: async () => {
        throw new Error('unused');
      },
    },
    chatFor: async () => null,
    tracker: nullTracker,
    env: {
      publicUrl: 'https://sw.test',
      supportEmail: 'help@sw.test',
      appId: '1',
      webhookSecret: SECRET,
      githubClientId: 'cid',
      githubClientSecret: 'secret',
      sessionSecret: 'sess',
      slackClientId: 'sid',
      slackClientSecret: 'ssecret',
    },
  };
  const worker = async () => {
    await queue.work(
      'load-config',
      (data) => loadConfig(deps, data as { installationId: number; owner: string }),
      { policies: ['stately'] },
    );
    await queue.drain();
  };
  return { app: createApp(deps, { getClientIp: () => '192.0.2.1' }), calls, queue, worker };
}

async function send(
  h: ReturnType<typeof harness>,
  event: string,
  payload: unknown,
  signature?: string,
): Promise<Response> {
  const body = JSON.stringify(payload);
  return h.app.request('/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signature ?? (await signer.sign(body)),
    },
    body,
  });
}

const created = {
  action: 'created',
  installation: { id: INST, account: { login: 'acme', type: 'Organization' } },
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

describe('github webhooks', () => {
  useCleanDb();

  test('rejects bad signature', async () => {
    const h = harness({ found: true, source: VALID });
    const res = await send(h, 'installation', created, 'sha256=deadbeef');
    expect(res.status).toBe(401);
    expect(await getInstallation(db, INST)).toBeNull();
    expect(h.calls).toEqual([]);
  });

  test('rejects missing signature', async () => {
    const h = harness({ found: true, source: VALID });
    const res = await h.app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'x-github-event': 'installation' },
      body: JSON.stringify(created),
    });
    expect(res.status).toBe(401);
    expect(await getInstallation(db, INST)).toBeNull();
  });

  test('a signed body that is not json is an invalid request', async () => {
    const h = harness({ found: true, source: VALID });
    const body = '{not json';
    const res = await h.app.request('/webhooks/github', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'installation',
        'x-hub-signature-256': await signer.sign(body),
      },
      body,
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
  });

  test('a body over 1 MB is rejected before it is read', async () => {
    const h = harness({ found: true, source: VALID });
    const declared = await h.app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'x-github-event': 'installation', 'content-length': String(1024 * 1024 + 1) },
      body: 'x',
    });
    expect(declared.status).toBe(413);
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.length;
        if (pulled > 4 * 1024 * 1024) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const streamed = await h.app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'x-github-event': 'installation' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(((await streamed.json()) as { error: { code: string } }).error.code).toBe(
      'payload_too_large',
    );
    expect(pulled).toBeLessThan(2 * 1024 * 1024);
    expect(await getInstallation(db, INST)).toBeNull();
  });

  test('installation created only enqueues jobs and returns 202', async () => {
    const h = harness({ found: true, source: VALID });
    const res = await send(h, 'installation', created);
    expect(res.status).toBe(202);
    const row = await getInstallation(db, INST);
    expect(row?.accountLogin).toBe('acme');
    expect(row?.status).not.toBe('configured');
    expect(h.calls).toEqual([]);
    expect(h.queue.enqueued).toEqual([
      { name: 'load-config', data: { installationId: INST, owner: 'acme' } },
    ]);
  });

  test('installation created with valid config is configured by the job', async () => {
    const h = harness({ found: true, source: VALID });
    await send(h, 'installation', created);
    await h.worker();
    expect((await getInstallation(db, INST))?.status).toBe('configured');
    expect(h.calls).toEqual(['acme']);
  });

  test('installation created without .github repo', async () => {
    const h = harness({ found: false, reason: 'no_repo' });
    await send(h, 'installation', created);
    await h.worker();
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('unconfigured');
    expect(row?.unconfiguredReason).toBe('no_repo');
  });

  test('installation_repositories reloads config', async () => {
    const h = harness({ found: true, source: VALID });
    await send(h, 'installation_repositories', { ...created, action: 'added' });
    await h.worker();
    expect((await getInstallation(db, INST))?.status).toBe('configured');
  });

  test('push with invalid config only enqueues jobs, and the load keeps the last valid', async () => {
    const good = parseConfig(VALID);
    if (!good.ok) throw new Error('bad fixture');
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    await setInstallationConfig(db, INST, { status: 'configured', config: good.config });
    const h = harness({ found: true, source: 'teams: nope' });
    const res = await send(
      h,
      'push',
      push('.github', 'refs/heads/main', { modified: ['standwise.yml'] }),
    );
    expect(res.status).toBe(202);
    expect(h.calls).toEqual([]);
    expect(h.queue.enqueued.map((j) => j.name)).toEqual(['validate-config', 'load-config']);
    expect((await getInstallation(db, INST))?.status).toBe('configured');
    await h.worker();
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('invalid');
    expect(row?.config).toEqual(good.config);
    expect(row?.configErrors?.length).toBeGreaterThan(0);
  });

  test('push removing standwise.yml makes installation unconfigured', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const h = harness({ found: false, reason: 'no_file' });
    await send(h, 'push', push('.github', 'refs/heads/main', { removed: ['standwise.yml'] }));
    await h.worker();
    const row = await getInstallation(db, INST);
    expect(row?.status).toBe('unconfigured');
    expect(row?.unconfiguredReason).toBe('no_file');
  });

  test('push to other repo ignored', async () => {
    const h = harness({ found: true, source: VALID });
    await send(h, 'push', push('app', 'refs/heads/main', { modified: ['standwise.yml'] }));
    expect(h.calls).toEqual([]);
  });

  test('push to non default branch only enqueues a validation', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const h = harness({ found: true, source: VALID });
    await send(h, 'push', push('.github', 'refs/heads/dev', { modified: ['standwise.yml'] }));
    expect(h.calls).toEqual([]);
    expect(h.queue.enqueued.map((j) => j.name)).toEqual(['validate-config']);
  });

  test('push not touching standwise.yml ignored', async () => {
    const h = harness({ found: true, source: VALID });
    await send(h, 'push', push('.github', 'refs/heads/main', { modified: ['README.md'] }));
    expect(h.calls).toEqual([]);
  });

  test('other events are accepted and ignored', async () => {
    const h = harness({ found: true, source: VALID });
    const res = await send(h, 'pull_request', { action: 'opened' });
    expect(res.status).toBe(202);
    expect(h.calls).toEqual([]);
  });

  test('installation deleted cascades', async () => {
    await upsertInstallation(db, { id: INST, accountLogin: 'acme', accountType: 'Organization' });
    const h = harness({ found: true, source: VALID });
    const res = await send(h, 'installation', { ...created, action: 'deleted' });
    expect(res.status).toBe(202);
    expect(await getInstallation(db, INST)).toBeNull();
  });
});
