import { afterEach, describe, expect, test } from 'bun:test';
import { ChatDeliveryError, createSlackChannel } from '../src';
import {
  CHANNEL_LOOKUP_BUDGET_MS,
  SLACK_REQUEST_TIMEOUT_MS,
  slackClientOptions,
} from '../src/channel';

type Call = { method: string; body: Record<string, unknown> };

let server: ReturnType<typeof Bun.serve> | undefined;

function fake(handlers: Record<string, (body: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const method = new URL(req.url).pathname.replace('/api/', '');
      const raw = await req.text();
      const body = Object.fromEntries(new URLSearchParams(raw)) as Record<string, unknown>;
      calls.push({ method, body });
      const handler = handlers[method];
      return Response.json(handler ? handler(body) : { ok: false, error: 'unknown_method' });
    },
  });
  return { calls, url: `http://localhost:${server.port}/api/` };
}

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

const msg = { fallbackText: 'fb', blocks: [{ type: 'divider' as const }] };

describe('createSlackChannel', () => {
  test('postToChannel resolves #name', async () => {
    const { calls, url } = fake({
      'conversations.list': () => ({
        ok: true,
        channels: [
          { id: 'C1', name: 'other' },
          { id: 'C2', name: 'daily-backend' },
        ],
      }),
      'chat.postMessage': () => ({ ok: true, channel: 'C2', ts: '1.1' }),
    });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    const ref = await ch.postToChannel('#daily-backend', msg);
    expect(ref).toEqual({ channel: 'C2', id: '1.1' });
    await ch.postToChannel('#daily-backend', msg);
    const post = calls.filter((c) => c.method === 'chat.postMessage');
    expect(post[0]?.body.channel).toBe('C2');
    expect(calls.filter((c) => c.method === 'conversations.list')).toHaveLength(1);
  });

  test('postToChannel passes channel ids through', async () => {
    const { calls, url } = fake({
      'chat.postMessage': () => ({ ok: true, channel: 'G9', ts: '2.2' }),
    });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    await ch.postToChannel('G9', msg);
    expect(calls.map((c) => c.method)).toEqual(['chat.postMessage']);
    expect(calls[0]?.body.channel).toBe('G9');
  });

  test('replyInThread sets thread_ts', async () => {
    const { calls, url } = fake({
      'chat.postMessage': () => ({ ok: true, channel: 'C2', ts: '3.3' }),
    });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    const ref = await ch.replyInThread({ channel: 'C2', id: '1.1' }, msg);
    expect(ref).toEqual({ channel: 'C2', id: '3.3' });
    expect(calls[0]?.body.thread_ts).toBe('1.1');
    expect(calls[0]?.body.channel).toBe('C2');
  });

  test('sendDirect opens im', async () => {
    const { calls, url } = fake({
      'conversations.open': () => ({ ok: true, channel: { id: 'D1' } }),
      'chat.postMessage': () => ({ ok: true, channel: 'D1', ts: '4.4' }),
    });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    const ref = await ch.sendDirect('U1', msg);
    expect(calls.map((c) => c.method)).toEqual(['conversations.open', 'chat.postMessage']);
    expect(calls[0]?.body.users).toBe('U1');
    expect(calls[1]?.body.channel).toBe('D1');
    expect(ref).toEqual({ channel: 'D1', id: '4.4' });
  });

  test('findUserByEmail returns id or null', async () => {
    const { url } = fake({
      'users.lookupByEmail': (b) =>
        b.email === 'a@x.com'
          ? { ok: true, user: { id: 'U7' } }
          : { ok: false, error: 'users_not_found' },
    });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    expect(await ch.findUserByEmail('a@x.com')).toBe('U7');
    expect(await ch.findUserByEmail('b@x.com')).toBeNull();
  });

  test('maps not_in_channel', async () => {
    const { url } = fake({ 'chat.postMessage': () => ({ ok: false, error: 'not_in_channel' }) });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    const err = await ch.postToChannel('C1', msg).catch((e) => e);
    expect(err).toBeInstanceOf(ChatDeliveryError);
    expect(err.code).toBe('not_in_channel');
  });

  test('unknown channel name maps to channel_not_found', async () => {
    const { url } = fake({ 'conversations.list': () => ({ ok: true, channels: [] }) });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    const err = await ch.postToChannel('#nope', msg).catch((e) => e);
    expect(err).toBeInstanceOf(ChatDeliveryError);
    expect(err.code).toBe('channel_not_found');
  });

  test('postMessage without ts maps to invalid_response', async () => {
    const { url } = fake({ 'chat.postMessage': () => ({ ok: true, channel: 'C1' }) });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url });
    const err = await ch.postToChannel('C1', msg).catch((e) => e);
    expect(err.code).toBe('invalid_response');
  });

  test('production client never retries and times out each request', () => {
    expect(slackClientOptions()).toEqual({ retryConfig: { retries: 0 }, timeout: 15000 });
    expect(slackClientOptions('http://x/api/')).toEqual({
      slackApiUrl: 'http://x/api/',
      retryConfig: { retries: 0 },
      timeout: SLACK_REQUEST_TIMEOUT_MS,
    });
  });

  test('a failing request is sent once', async () => {
    const calls: string[] = [];
    server = Bun.serve({
      port: 0,
      fetch(req) {
        calls.push(new URL(req.url).pathname);
        return new Response('boom', { status: 500 });
      },
    });
    const ch = createSlackChannel('xoxb-t', {
      slackApiUrl: `http://localhost:${server.port}/api/`,
    });
    await expect(ch.postToChannel('C1', msg)).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  test('channel lookup stops paging past its budget and does not post', async () => {
    let clock = 0;
    const { calls, url } = fake({
      'conversations.list': () => {
        clock += CHANNEL_LOOKUP_BUDGET_MS / 2 + 1;
        return {
          ok: true,
          channels: [{ id: 'C1', name: 'x' }],
          response_metadata: { next_cursor: 'n' },
        };
      },
      'chat.postMessage': () => ({ ok: true, channel: 'C2', ts: '1.1' }),
    });
    const ch = createSlackChannel('xoxb-t', { slackApiUrl: url, now: () => clock });
    const err = await ch.postToChannel('#daily', msg).catch((e) => e);
    expect(err).toBeInstanceOf(ChatDeliveryError);
    expect(err.code).toBe('timeout');
    expect(calls.filter((c) => c.method === 'conversations.list')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'chat.postMessage')).toHaveLength(0);
  });
});
