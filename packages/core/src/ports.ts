import type { Message } from './message';

export type MessageRef = { channel: string; id: string };

export type ChannelCheck = 'ok' | 'not_found' | 'not_member';

export interface ChatChannel {
  postToChannel(channel: string, msg: Message): Promise<MessageRef>;
  replyInThread(ref: MessageRef, msg: Message): Promise<MessageRef>;
  sendDirect(userId: string, msg: Message): Promise<MessageRef>;
  findUserByEmail(email: string): Promise<string | null>;
  checkChannel(channel: string): Promise<ChannelCheck>;
}
