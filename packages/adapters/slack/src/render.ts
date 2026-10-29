import type { Block, Inline, Message } from '@standwise/core';

const HEADER_LIMIT = 150;

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderInline(i: Inline): string {
  if (typeof i === 'string') return escapeText(i);
  if ('mention' in i) return `<@${i.mention}>`;
  return `<${i.link.url}|${escapeText(i.link.text)}>`;
}

function renderBlock(b: Block): object {
  switch (b.type) {
    case 'heading':
      return { type: 'header', text: { type: 'plain_text', text: b.text.slice(0, HEADER_LIMIT) } };
    case 'paragraph':
      return {
        type: 'section',
        text: { type: 'mrkdwn', text: b.content.map(renderInline).join('') },
      };
    case 'list':
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: b.items.map((item) => `• ${item.map(renderInline).join('')}`).join('\n'),
        },
      };
    case 'divider':
      return { type: 'divider' };
  }
}

export function renderSlack(msg: Message): { text: string; blocks: object[] } {
  return { text: msg.fallbackText, blocks: msg.blocks.map(renderBlock) };
}
