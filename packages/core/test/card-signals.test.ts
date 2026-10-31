import { describe, expect, test } from 'bun:test';
import { type CardSnapshot, cardStaleFingerprint, detectCardSignals } from '../src/card-signals';

const now = new Date('2026-10-30T12:00:00Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(now.getTime() - ms);

const card = (over: Partial<CardSnapshot> = {}): CardSnapshot => ({
  id: 'c1',
  identifier: 'BE-1',
  url: 'https://linear.app/acme/issue/BE-1/x',
  title: 'Fix login',
  startedAt: ago(1000),
  ...over,
});

describe('detectCardSignals', () => {
  test('flags a card started 5 days and 1 minute ago', () => {
    const startedAt = ago(5 * DAY + 60_000);
    const [s] = detectCardSignals([card({ startedAt })], now, 5);
    expect(s?.kind).toBe('card_stale');
    expect(s?.since).toEqual(startedAt);
    expect(s?.ref).toEqual({
      kind: 'card',
      url: 'https://linear.app/acme/issue/BE-1/x',
      title: 'Fix login',
    });
  });

  test('does not flag at 4 days 23 hours', () => {
    expect(detectCardSignals([card({ startedAt: ago(4 * DAY + 23 * 3_600_000) })], now, 5)).toEqual(
      [],
    );
  });

  test('flags at exactly 5 days', () => {
    expect(detectCardSignals([card({ startedAt: ago(5 * DAY) })], now, 5)).toHaveLength(1);
  });

  test('fingerprint changes with a new startedAt', () => {
    const a = new Date('2026-10-20T00:00:00Z');
    const b = new Date('2026-10-21T00:00:00Z');
    expect(cardStaleFingerprint('c1', a)).toBe('card_stale:c1@2026-10-20T00:00:00.000Z');
    expect(cardStaleFingerprint('c1', a)).not.toBe(cardStaleFingerprint('c1', b));
    const [s] = detectCardSignals([card({ startedAt: a })], now, 5);
    expect(s?.fingerprint).toBe(cardStaleFingerprint('c1', a));
  });
});
