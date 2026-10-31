import type { Language } from './config';
import type { Ref } from './daily';
import { t } from './i18n';
import { type Message, toPlainText } from './message';

export type SuggestionDmKind = 'pr_no_review' | 'ci_failing' | 'card_stale';

export type SuggestionDmInput = { lang: Language; ref: Ref } & (
  | { kind: 'pr_no_review' | 'ci_failing'; hours: number }
  | { kind: 'card_stale'; days: number }
);

export function buildSuggestionDm(input: SuggestionDmInput): Message {
  const { lang, ref } = input;
  const amount: Record<string, number> =
    input.kind === 'card_stale' ? { days: input.days } : { hours: input.hours };
  const title = ref.title ?? ref.url;
  const blocks: Message['blocks'] = [
    { type: 'heading', text: t(lang, 'suggestion.dm.title') },
    {
      type: 'paragraph',
      content: [t(lang, `suggestion.${input.kind}`, { title, ...amount })],
    },
    { type: 'paragraph', content: [{ link: { text: title, url: ref.url } }] },
  ];
  return { fallbackText: toPlainText(blocks), blocks };
}
