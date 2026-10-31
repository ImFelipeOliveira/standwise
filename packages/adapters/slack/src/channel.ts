import { WebClient, type WebClientOptions } from '@slack/web-api';
import type { ChatChannel, Message, MessageRef } from '@standwise/core';
import { ChatDeliveryError, mapSlackErrors } from './errors';
import { renderSlack } from './render';

export const SLACK_REQUEST_TIMEOUT_MS = 15_000;
export const CHANNEL_LOOKUP_BUDGET_MS = 2 * 60 * 1000;

export function slackClientOptions(slackApiUrl?: string): WebClientOptions {
  return {
    ...(slackApiUrl ? { slackApiUrl } : {}),
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: SLACK_REQUEST_TIMEOUT_MS,
  };
}

export function createWebClient(token: string | undefined, slackApiUrl?: string): WebClient {
  return new WebClient(token, slackClientOptions(slackApiUrl));
}

export function createSlackChannel(
  botToken: string,
  opts: { slackApiUrl?: string; now?: () => number } = {},
): ChatChannel {
  const client = createWebClient(botToken, opts.slackApiUrl);
  const now = opts.now ?? Date.now;
  const channelIds = new Map<string, string>();

  async function resolveChannel(channel: string): Promise<string> {
    if (!channel.startsWith('#')) return channel;
    const name = channel.slice(1);
    if (channelIds.size === 0) {
      const startedAt = now();
      let cursor: string | undefined;
      do {
        if (now() - startedAt > CHANNEL_LOOKUP_BUDGET_MS) {
          channelIds.clear();
          throw new ChatDeliveryError('timeout', 'channel lookup took too long');
        }
        const res = await client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          cursor,
        });
        for (const c of res.channels ?? []) {
          if (c.id && c.name) channelIds.set(c.name, c.id);
        }
        cursor = res.response_metadata?.next_cursor || undefined;
      } while (cursor);
    }
    const id = channelIds.get(name);
    if (!id) throw new ChatDeliveryError('channel_not_found', `channel not found: ${channel}`);
    return id;
  }

  async function post(channel: string, msg: Message, threadTs?: string): Promise<MessageRef> {
    const rendered = renderSlack(msg);
    const res = await client.chat.postMessage({
      channel,
      text: rendered.text,
      blocks: rendered.blocks as never,
      thread_ts: threadTs,
    });
    if (!res.ts || !res.channel) {
      throw new ChatDeliveryError('invalid_response', 'slack response missing ts or channel');
    }
    return { channel: res.channel, id: res.ts };
  }

  return {
    postToChannel: (channel, msg) =>
      mapSlackErrors(async () => post(await resolveChannel(channel), msg)),
    replyInThread: (ref, msg) => mapSlackErrors(() => post(ref.channel, msg, ref.id)),
    sendDirect: (userId, msg) =>
      mapSlackErrors(async () => {
        const open = await client.conversations.open({ users: userId });
        const id = open.channel?.id;
        if (!id)
          throw new ChatDeliveryError('channel_not_found', `could not open dm with ${userId}`);
        return post(id, msg);
      }),
    findUserByEmail: async (email) => {
      try {
        const res = await mapSlackErrors(() => client.users.lookupByEmail({ email }));
        return res.user?.id ?? null;
      } catch (e) {
        if (e instanceof ChatDeliveryError && e.code === 'users_not_found') return null;
        throw e;
      }
    },
  };
}
