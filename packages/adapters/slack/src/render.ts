import type { Block, Inline, Message } from '@standwise/core';

const HEADER_LIMIT = 150;
const SECTION_LIMIT = 3000;

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderInline(i: Inline): string {
  if (typeof i === 'string') return escapeText(i);
  if ('mention' in i) return `<@${i.mention}>`;
  const url = safeUrl(i.link.url);
  return url ? `<${url}|${escapeText(i.link.text)}>` : escapeText(i.link.text);
}

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href
      .replaceAll('|', '%7C')
      .replaceAll('<', '%3C')
      .replaceAll('>', '%3E')
      .replace(/\s/g, (c) => encodeURIComponent(c));
  } catch {
    return null;
  }
}

function section(text: string): object | null {
  if (text.length === 0) return null;
  const clipped = text.length > SECTION_LIMIT ? `${text.slice(0, SECTION_LIMIT - 1)}…` : text;
  return { type: 'section', text: { type: 'mrkdwn', text: clipped } };
}

function renderBlock(b: Block): object | null {
  switch (b.type) {
    case 'heading':
      return b.text.length === 0
        ? null
        : { type: 'header', text: { type: 'plain_text', text: b.text.slice(0, HEADER_LIMIT) } };
    case 'paragraph':
      return section(b.content.map(renderInline).join(''));
    case 'list':
      return section(b.items.map((item) => `• ${item.map(renderInline).join('')}`).join('\n'));
    case 'divider':
      return { type: 'divider' };
  }
}

export function renderSlack(msg: Message): { text: string; blocks: object[] } {
  return {
    text: escapeText(msg.fallbackText),
    blocks: msg.blocks.map(renderBlock).filter((b): b is object => b !== null),
  };
}
