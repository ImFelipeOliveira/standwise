import type { TeamConfig } from './config';
import { t } from './i18n';
import { type Message, toPlainText } from './message';

export function buildReminder(input: {
  team: TeamConfig;
  date: string;
  digestAt: string;
}): Message {
  const lang = input.team.language;
  const blocks: Message['blocks'] = [
    { type: 'heading', text: t(lang, 'reminder.title') },
    { type: 'paragraph', content: [t(lang, 'reminder.body', { digestAt: input.digestAt })] },
  ];
  return { fallbackText: toPlainText(blocks), blocks };
}
