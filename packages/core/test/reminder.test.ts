import { describe, expect, test } from 'bun:test';
import type { TeamConfig } from '../src/config';
import { buildReminder } from '../src/reminder';

const team = (language: 'pt-BR' | 'en') => ({ name: 'backend', language }) as unknown as TeamConfig;

describe('buildReminder', () => {
  test('english reminder carries the digest time and the daily hint', () => {
    const msg = buildReminder({ team: team('en'), date: '2026-10-28', digestAt: '10:00' });
    expect(msg.fallbackText).toContain('Daily reminder');
    expect(msg.fallbackText).toContain('10:00');
    expect(msg.fallbackText).toContain('/daily');
  });

  test('portuguese reminder carries the digest time and the daily hint', () => {
    const msg = buildReminder({ team: team('pt-BR'), date: '2026-10-28', digestAt: '10:30' });
    expect(msg.fallbackText).toContain('Lembrete da daily');
    expect(msg.fallbackText).toContain('10:30');
    expect(msg.fallbackText).toContain('/daily');
  });

  test('does not mention managers', () => {
    const msg = buildReminder({ team: team('en'), date: '2026-10-28', digestAt: '10:00' });
    expect(msg.fallbackText.toLowerCase()).not.toContain('manager');
  });
});
