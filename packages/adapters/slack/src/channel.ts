import { WebClient } from '@slack/web-api';
import type { ChatChannel, Message, MessageRef } from '@standwise/core';
import { ChatDeliveryError, mapSlackErrors } from './errors';
import { renderSlack } from './render';

export function createWebClient(token: string | undefined, slackApiUrl?: string): WebClient {
  return new WebClient(token, slackApiUrl ? { slackApiUrl, retryConfig: { retries: 0 } } : {});
}

export function createSlackChannel(
  botToken: string,
  opts: { slackApiUrl?: string } = {},
): ChatChannel {
  const client = createWebClient(botToken, opts.slackApiUrl);
  const channelIds = new Map<string, string>();

  async function resolveChannel(channel: string): Promise<string> {
    if (!channel.startsWith('#')) return channel;
    const name = channel.slice(1);
    if (channelIds.size === 0) {
      let cursor: string | undefined;
      do {
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
