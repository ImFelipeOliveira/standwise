import type { Ref } from './daily';
import type { Signal } from './signals';

export type CardSnapshot = {
  id: string;
  identifier: string;
  url: string;
  title: string;
  startedAt: Date;
};

const DAY_MS = 86_400_000;

export function cardStaleFingerprint(id: string, startedAt: Date): string {
  return `card_stale:${id}@${startedAt.toISOString()}`;
}

export function detectCardSignals(
  cards: CardSnapshot[],
  now: Date,
  cardStaleDays: number,
): Signal[] {
  const signals: Signal[] = [];
  for (const card of cards) {
    if (now.getTime() - card.startedAt.getTime() < cardStaleDays * DAY_MS) continue;
    const ref: Ref = { kind: 'card', url: card.url, title: card.title };
    signals.push({
      kind: 'card_stale',
      ref,
      fingerprint: cardStaleFingerprint(card.id, card.startedAt),
      since: card.startedAt,
    });
  }
  return signals;
}
