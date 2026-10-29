import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { writeCredentials } from '../src/credentials';
import type { Io } from '../src/io';
import { createMcpServer } from '../src/mcp/server';
import { makeIo } from './support';

type Seen = { method: string; path: string; auth: string | null; body: string };
const servers: { stop(close?: boolean): void }[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) server.stop(true);
});

const DRAFT = {
  org: 'acme',
  date: '2026-10-28',
  since: '2026-10-27T03:00:00.000Z',
  teams: ['backend'],
  activity: [{ kind: 'pull_request', title: 'Add rate limits' }],
  suggestions: ['Shipped rate limits'],
};
const TEAMS = {
  data: [
    {
      name: 'backend',
      timezone: 'America/Sao_Paulo',
      workdays: ['mon'],
      remindAt: '09:00',
      digestAt: '10:00',
      memberLogins: ['alice'],
    },
  ],
  next_cursor: null,
};
const DIGESTS = {
  data: [{ team: 'backend', date: '2026-10-27', status: 'sent', sentAt: null, missing: [] }],
  next_cursor: null,
};
const DAILIES = {
  data: [
    {
      id: 'd1',
      login: 'bob',
      date: '2026-10-27',
      submittedAt: '2026-10-27T12:00:00.000Z',
      teams: ['backend'],
      yesterday: [],
      today: [{ text: 'review', ref: null }],
      blockers: [],
    },
  ],
  next_cursor: 'abc',
};
const BLOCKERS = {
  data: [{ text: 'waiting', ref: null, author: 'bob', date: '2026-10-27', teams: ['backend'] }],
  next_cursor: null,
};

function fakeApi() {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      seen.push({
        method: req.method,
        path: url.pathname + url.search,
        auth: req.headers.get('authorization'),
        body: await req.text(),
      });
      if (url.pathname === '/v1/draft') return Response.json(DRAFT);
      if (url.pathname === '/v1/dailies') {
        return Response.json({ date: '2026-10-28', teams: ['backend'], late: false });
      }
      if (url.pathname === '/v1/manage/teams') return Response.json(TEAMS);
      if (url.pathname === '/v1/manage/digests') return Response.json(DIGESTS);
      if (url.pathname === '/v1/manage/dailies') return Response.json(DAILIES);
      if (url.pathname === '/v1/manage/blockers') return Response.json(BLOCKERS);
      return Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 });
    },
  });
  servers.push(server);
  return { url: `http://localhost:${server.port}`, seen };
}

const ORGS = [{ installationId: 1, login: 'acme' }];

async function connect(io: Io) {
  const server = createMcpServer(io);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}

async function loggedIn(orgs = ORGS) {
  const api = fakeApi();
  const ctx = await makeIo();
  await writeCredentials(ctx.io.env, { apiUrl: api.url, token: 'sw_tok', login: 'alice', orgs });
  return { api, ctx, client: await connect(ctx.io) };
}

type Result = Awaited<ReturnType<Client['callTool']>>;
const text = (result: Result) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

const DAILY = {
  yesterday: [{ text: 'Shipped rate limits' }],
  today: [{ text: 'Review PRs' }],
  blockers: [],
};

const TOOLS = [
  'standwise_get_digest',
  'standwise_get_draft',
  'standwise_list_blockers',
  'standwise_list_dailies',
  'standwise_list_teams',
  'standwise_submit_daily',
  'standwise_whoami',
];

describe('mcp server', () => {
  test('lists tools with input and output schemas', async () => {
    const { client } = await loggedIn();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
    const submit = tools.find((t) => t.name === 'standwise_submit_daily');
    expect(submit?.description).toContain('explicit confirmation');
    expect(submit?.inputSchema.required).toEqual(
      expect.arrayContaining(['yesterday', 'today', 'blockers', 'confirmed']),
    );
  });

  test('instructions keep the anti-surveillance and language rules', async () => {
    const { client } = await loggedIn();
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('explicit confirmation');
    expect(instructions).toContain("person's language");
    expect(instructions).toContain('Never translate or rewrite');
    expect(instructions).toContain('ranking');
    expect(instructions).toContain('unblock');
  });

  test('whoami returns the stored login and orgs', async () => {
    const { client } = await loggedIn();
    const result = await client.callTool({ name: 'standwise_whoami', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ login: 'alice', orgs: ORGS });
  });

  test('draft passthrough', async () => {
    const { client, api } = await loggedIn();
    const result = await client.callTool({ name: 'standwise_get_draft', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(DRAFT);
    expect(JSON.parse(text(result))).toEqual(DRAFT);
    expect(api.seen).toEqual([
      { method: 'GET', path: '/v1/draft?org=acme', auth: 'Bearer sw_tok', body: '' },
    ]);
  });

  test('an ambiguous org is an error listing the orgs', async () => {
    const { client, api } = await loggedIn([
      { installationId: 1, login: 'acme' },
      { installationId: 2, login: 'beta' },
    ]);
    const result = await client.callTool({ name: 'standwise_get_draft', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('ambiguous_org');
    expect(text(result)).toContain('acme, beta');
    expect(api.seen).toEqual([]);
    const chosen = await client.callTool({
      name: 'standwise_get_draft',
      arguments: { org: 'beta' },
    });
    expect(chosen.isError).toBeFalsy();
    expect(api.seen.map((s) => s.path)).toEqual(['/v1/draft?org=beta']);
  });

  test('submit requires confirmation', async () => {
    const { client, api } = await loggedIn();
    for (const args of [DAILY, { ...DAILY, confirmed: false }, { ...DAILY, confirmed: 'yes' }]) {
      const result = await client.callTool({ name: 'standwise_submit_daily', arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('confirmation_required');
      expect(text(result)).toContain('explicit confirmation');
    }
    expect(api.seen).toEqual([]);
    const result = await client.callTool({
      name: 'standwise_submit_daily',
      arguments: { ...DAILY, confirmed: true },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      date: '2026-10-28',
      teams: ['backend'],
      late: false,
    });
    expect(api.seen).toHaveLength(1);
    expect(api.seen[0]?.method).toBe('POST');
    expect(api.seen[0]?.path).toBe('/v1/dailies');
    expect(JSON.parse(api.seen[0]?.body ?? '{}')).toEqual({ org: 'acme', ...DAILY });
  });

  test('submit keeps the text exactly as given', async () => {
    const { client, api } = await loggedIn();
    const words = { ...DAILY, today: [{ text: 'Revisar os PRs do time, sem pressa 🙂' }] };
    await client.callTool({
      name: 'standwise_submit_daily',
      arguments: { ...words, confirmed: true },
    });
    expect(JSON.parse(api.seen[0]?.body ?? '{}').today).toEqual(words.today);
  });

  test('not logged in', async () => {
    const ctx = await makeIo();
    const client = await connect(ctx.io);
    const calls: Record<string, Record<string, unknown>> = {
      standwise_whoami: {},
      standwise_get_draft: {},
      standwise_submit_daily: { ...DAILY, confirmed: true },
      standwise_list_teams: {},
      standwise_get_digest: { team: 'backend', date: '2026-10-27' },
      standwise_list_dailies: { team: 'backend', from: '2026-10-20', to: '2026-10-27' },
      standwise_list_blockers: { team: 'backend' },
    };
    for (const [name, args] of Object.entries(calls)) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('not_logged_in');
      expect(text(result)).toContain('standwise login');
    }
  });

  test('stored credentials are bound to their api origin', async () => {
    const api = fakeApi();
    const ctx = await makeIo({ STANDWISE_API_URL: 'https://evil.example' });
    await writeCredentials(ctx.io.env, {
      apiUrl: api.url,
      token: 'sw_tok',
      login: 'alice',
      orgs: ORGS,
    });
    const client = await connect(ctx.io);
    const result = await client.callTool({ name: 'standwise_get_draft', arguments: {} });
    expect(result.isError).toBe(true);
    expect(api.seen).toEqual([]);
  });

  test('api errors keep their code', async () => {
    const { client } = await loggedIn();
    for (const server of servers.splice(0)) server.stop(true);
    const result = await client.callTool({ name: 'standwise_get_draft', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('network_error');
  });

  test('manager tools list and return the api data', async () => {
    const { client, api } = await loggedIn();
    const teams = await client.callTool({ name: 'standwise_list_teams', arguments: {} });
    expect(teams.structuredContent).toEqual(TEAMS);
    const digest = await client.callTool({
      name: 'standwise_get_digest',
      arguments: { team: 'backend', date: '2026-10-27' },
    });
    expect(digest.structuredContent).toEqual({ digest: DIGESTS.data[0] });
    const dailies = await client.callTool({
      name: 'standwise_list_dailies',
      arguments: { team: 'backend', from: '2026-10-20', to: '2026-10-27', cursor: 'xyz' },
    });
    expect(dailies.structuredContent).toEqual(DAILIES);
    const blockers = await client.callTool({
      name: 'standwise_list_blockers',
      arguments: { org: 'acme', team: 'back end' },
    });
    expect(blockers.structuredContent).toEqual(BLOCKERS);
    expect(api.seen.map((s) => s.path)).toEqual([
      '/v1/manage/teams?org=acme',
      '/v1/manage/digests?org=acme&team=backend&from=2026-10-27&to=2026-10-27',
      '/v1/manage/dailies?org=acme&team=backend&from=2026-10-20&to=2026-10-27&cursor=xyz',
      '/v1/manage/blockers?org=acme&team=back+end',
    ]);
    expect(api.seen.every((s) => s.auth === 'Bearer sw_tok')).toBe(true);
  });

  test('a digest that does not exist is null', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ data: [], next_cursor: null }),
    });
    servers.push(server);
    const ctx = await makeIo();
    await writeCredentials(ctx.io.env, {
      apiUrl: `http://localhost:${server.port}`,
      token: 'sw_tok',
      login: 'alice',
      orgs: ORGS,
    });
    const client = await connect(ctx.io);
    const result = await client.callTool({
      name: 'standwise_get_digest',
      arguments: { team: 'backend', date: '2026-10-27' },
    });
    expect(result.structuredContent).toEqual({ digest: null });
  });

  test('daily prompt', async () => {
    const { client } = await loggedIn();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['daily']);
    const prompt = await client.getPrompt({ name: 'daily', arguments: {} });
    const body = prompt.messages
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');
    expect(body).toContain('standwise_get_draft');
    expect(body).toContain('explicit confirmation');
    expect(body).toContain('standwise_submit_daily');
    expect(body).toContain("person's language");
    expect(body).toContain('Never translate or rewrite');
  });
});

describe('standwise mcp over stdio', () => {
  test('answers every request on stdout, only with protocol messages, and exits when stdin ends', async () => {
    const ctx = await makeIo();
    const lines = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'standwise_whoami' } },
    ];
    const child = Bun.spawn(['bun', resolve(import.meta.dir, '../src/main.ts'), 'mcp'], {
      env: { PATH: process.env.PATH ?? '', XDG_CONFIG_HOME: ctx.home, HOME: ctx.home },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    child.stdin.write(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
    await child.stdin.end();
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const messages = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> });
    expect(messages.map((m) => m.id).sort()).toEqual([1, 2]);
    const whoami = messages.find((m) => m.id === 2);
    expect(whoami?.result.isError).toBe(true);
    expect(JSON.stringify(whoami?.result)).toContain('standwise login');
  });
});
