import type { Language } from './config';
import type { Item } from './daily';
import { formatDate, type MessageKey, t } from './i18n';
import { type Inline, type Message, type Person, personInline, toPlainText } from './message';

export type BlockerRouteReason =
  | 'pr_reviewers'
  | 'codeowners'
  | 'card_blocker'
  | 'card_owner'
  | 'manager';

const REASON_KEYS: Record<BlockerRouteReason, MessageKey> = {
  pr_reviewers: 'blockerRouted.reason.pr_reviewers',
  codeowners: 'blockerRouted.reason.codeowners',
  card_blocker: 'blockerRouted.reason.card_blocker',
  card_owner: 'blockerRouted.reason.card_owner',
  manager: 'blockerRouted.reason.manager',
};

export function buildBlockerRouted(input: {
  lang: Language;
  author: Person;
  blocker: Item;
  reason: BlockerRouteReason;
  date: string;
}): Message {
  const { lang, author, blocker } = input;
  const template = t(lang, 'blockerRouted.body');
  const content: Inline[] = [];
  template.split('{name}').forEach((raw, index) => {
    if (index > 0) content.push(personInline(author));
    const part = raw.split('{blocker}').join(blocker.text);
    if (part) content.push(part);
  });
  const blocks: Message['blocks'] = [
    {
      type: 'heading',
      text: `${t(lang, 'blockerRouted.title', { name: `@${author.login}` })} · ${formatDate(lang, input.date)}`,
    },
    { type: 'paragraph', content },
  ];
  if (blocker.ref) {
    blocks.push({
      type: 'paragraph',
      content: [{ link: { text: blocker.ref.title ?? blocker.ref.url, url: blocker.ref.url } }],
    });
  }
  blocks.push({ type: 'paragraph', content: [t(lang, REASON_KEYS[input.reason])] });
  return { fallbackText: toPlainText(blocks), blocks };
}
