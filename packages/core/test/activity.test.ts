import { describe, expect, test } from 'bun:test';
import { type ActivityItem, clampTitle } from '../src';

const item = (kind: ActivityItem['kind'], at: string, title = 't'): ActivityItem => ({
  kind,
  title,
  url: 'https://linear.app/acme/issue/BE-1',
  repo: 'BE',
  at: new Date(at),
});

describe('card activity kinds', () => {
  test('card kinds are valid and sort newest first', () => {
    const items = [
      item('card_started', '2026-10-28T10:00:00Z'),
      item('pr_opened', '2026-10-29T10:00:00Z'),
      item('card_done', '2026-10-30T10:00:00Z'),
    ];
    const sorted = [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
    expect(sorted.map((i) => i.kind)).toEqual(['card_done', 'pr_opened', 'card_started']);
  });

  test('clampTitle applies to card titles', () => {
    expect(clampTitle('Fix‮ login\n')).toBe('Fix login');
    expect(clampTitle('x'.repeat(300))).toHaveLength(200);
  });
});
