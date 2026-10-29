import type { Language } from './config';

const messages = {
  'pt-BR': {
    digestTitle: 'Daily — {team} — {date}',
    blockers: 'Impedimentos',
    yesterday: 'Ontem',
    today: 'Hoje',
    missing: 'Não enviaram a daily:',
    lateDaily: 'Daily enviada depois do consolidado:',
  },
  en: {
    digestTitle: 'Daily — {team} — {date}',
    blockers: 'Blockers',
    yesterday: 'Yesterday',
    today: 'Today',
    missing: 'Did not send the daily:',
    lateDaily: 'Daily sent after the digest:',
  },
} as const;

export type MessageKey = keyof (typeof messages)['en'];

export function t(
  lang: Language,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  const template: string = messages[lang][key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** ISO `YYYY-MM-DD` to the language's display format (pt-BR: DD/MM/YYYY). */
export function formatDate(lang: Language, isoDate: string): string {
  if (lang !== 'pt-BR') return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
