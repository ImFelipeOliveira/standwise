import type { Language, TeamConfig } from './config';
import type { DailySubmission, Item } from './daily';
import { formatDate, t } from './i18n';
import {
  type Block,
  type Inline,
  type Message,
  type Person,
  personInline,
  toPlainText,
} from './message';

export type DigestEntry = Person & { daily: DailySubmission };

function itemInlines(item: Item): Inline[] {
  if (!item.ref) return [item.text];
  return [item.text, ' ', { link: { text: item.ref.title ?? item.text, url: item.ref.url } }];
}

/** Config member order; "@org/slug" entries match no login, so unmatched people follow in given order. */
function orderEntries(team: TeamConfig, entries: DigestEntry[]): DigestEntry[] {
  const order = 'memberLogins' in team ? (team.memberLogins as string[]) : team.members;
  const remaining = [...entries];
  const ordered: DigestEntry[] = [];
  for (const member of order) {
    const wanted = member.toLowerCase();
    const idx = remaining.findIndex((e) => e.login.toLowerCase() === wanted);
    if (idx !== -1) ordered.push(...remaining.splice(idx, 1));
  }
  return [...ordered, ...remaining];
}

function personSection(entry: DigestEntry, lang: Language): Block[] {
  const blocks: Block[] = [{ type: 'paragraph', content: [personInline(entry)] }];
  const { yesterday, today } = entry.daily;
  if (yesterday.length > 0) {
    blocks.push({ type: 'paragraph', content: [`${t(lang, 'yesterday')}:`] });
    blocks.push({ type: 'list', items: yesterday.map(itemInlines) });
  }
  blocks.push({ type: 'paragraph', content: [`${t(lang, 'today')}:`] });
  blocks.push({ type: 'list', items: today.map(itemInlines) });
  return blocks;
}

function blockersSection(entries: DigestEntry[], lang: Language): Block[] {
  const items: Inline[][] = entries.flatMap((e) =>
    e.daily.blockers.map((b) => [personInline(e), ': ', ...itemInlines(b)]),
  );
  if (items.length === 0) return [];
  return [
    { type: 'heading', text: t(lang, 'blockers') },
    { type: 'list', items },
  ];
}

function message(blocks: Block[]): Message {
  return { fallbackText: toPlainText(blocks), blocks };
}

export function buildDigest(input: {
  team: TeamConfig;
  date: string;
  entries: DigestEntry[];
  missing: Person[];
}): Message {
  const { team, date, missing } = input;
  const lang = team.language;
  const entries = orderEntries(team, input.entries);
  const blocks: Block[] = [
    {
      type: 'heading',
      text: t(lang, 'digestTitle', { team: team.name, date: formatDate(lang, date) }),
    },
    ...blockersSection(entries, lang),
    ...entries.flatMap((e) => personSection(e, lang)),
  ];
  if (missing.length > 0) {
    const content: Inline[] = [t(lang, 'missing')];
    missing.forEach((p, i) => {
      content.push(i === 0 ? ' ' : ', ', personInline(p));
    });
    blocks.push({ type: 'paragraph', content });
  }
  return message(blocks);
}

/** One person's daily, for a thread reply after the digest was already posted. */
export function buildLateDaily(entry: DigestEntry, lang: Language): Message {
  return message([
    { type: 'paragraph', content: [t(lang, 'lateDaily')] },
    ...personSection(entry, lang),
    ...blockersSection([entry], lang),
  ]);
}
