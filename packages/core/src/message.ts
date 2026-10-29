export type Inline = string | { mention: string } | { link: { text: string; url: string } };

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'divider' };

export type Message = { fallbackText: string; blocks: Block[] };

/** Chat-agnostic person; without `chatUserId` they render as plain `@login` text. */
export type Person = { login: string; chatUserId?: string };

export function personInline(p: Person): Inline {
  return p.chatUserId ? { mention: p.chatUserId } : `@${p.login}`;
}

function inlineToText(i: Inline): string {
  if (typeof i === 'string') return i;
  if ('mention' in i) return `@${i.mention}`;
  return `${i.link.text} (${i.link.url})`;
}

/** Plain-text rendering used as the notification/fallback text. */
export function toPlainText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return b.text;
        case 'paragraph':
          return b.content.map(inlineToText).join('');
        case 'list':
          return b.items.map((item) => `- ${item.map(inlineToText).join('')}`).join('\n');
        case 'divider':
          return '---';
        default:
          return '';
      }
    })
    .join('\n');
}
