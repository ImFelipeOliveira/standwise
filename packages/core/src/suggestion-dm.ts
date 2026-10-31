import type { Language } from './config';
import type { Ref } from './daily';
import { t } from './i18n';
import { type Message, toPlainText } from './message';

export type SuggestionDmKind = 'pr_no_review' | 'ci_failing';

export function buildSuggestionDm(input: {
  lang: Language;
  kind: SuggestionDmKind;
  ref: Ref;
  hours: number;
}): Message {
  const { lang, ref } = input;
  const title = ref.title ?? ref.url;
  const blocks: Message['blocks'] = [
    { type: 'heading', text: t(lang, 'suggestion.dm.title') },
    {
      type: 'paragraph',
      content: [t(lang, `suggestion.${input.kind}`, { title, hours: input.hours })],
    },
    { type: 'paragraph', content: [{ link: { text: title, url: ref.url } }] },
  ];
  return { fallbackText: toPlainText(blocks), blocks };
}
