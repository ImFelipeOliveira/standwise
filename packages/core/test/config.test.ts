import { describe, expect, test } from 'bun:test';
import { parseConfig } from '../src/config';

const specExample = `
teams:
  - name: backend
    timezone: America/Boa_Vista
    workdays: [mon, tue, wed, thu, fri]
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR
    managers: [felipeoliveira]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
    tracker:
      provider: linear
      team: BE
    signals:
      pr_review_hours: 48
      card_stale_days: 5
members:
  alice: { slack: U0123, linear: alice@acme.com }
`;

const team = (over: Record<string, unknown> = {}) => ({
  name: 'backend',
  timezone: 'America/Boa_Vista',
  remind_at: '09:30',
  digest_at: '10:00',
  managers: ['felipe'],
  members: ['alice'],
  chat: { provider: 'slack', channel: '#daily' },
  ...over,
});

const toYaml = (teams: unknown[]) => JSON.stringify({ teams });

describe('parseConfig', () => {
  test('parses the spec example', () => {
    const r = parseConfig(specExample);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.teams[0]?.digestAt).toBe('10:00');
    expect(r.config.teams[0]?.signals.prReviewHours).toBe(48);
    expect(r.config.members.alice?.slack).toBe('U0123');
  });

  test('applies defaults', () => {
    const r = parseConfig(toYaml([team()]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.config.teams[0];
    expect(t?.language).toBe('pt-BR');
    expect(t?.workdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(t?.signals.cardStaleDays).toBe(5);
    expect(t?.signals.prReviewHours).toBe(48);
    expect(t?.tracker).toBeUndefined();
    expect(r.config.members).toEqual({});
  });

  test('rejects bad time', () => {
    const r = parseConfig(toYaml([team({ digest_at: '25:00' })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'teams.0.digest_at')).toBe(true);
  });

  test('rejects unknown timezone', () => {
    const r = parseConfig(toYaml([team({ timezone: 'Mars/Base' })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'teams.0.timezone')).toBe(true);
  });

  test('rejects duplicate team names', () => {
    const r = parseConfig(toYaml([team(), team()]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'teams.1.name')).toBe(true);
  });

  test('rejects invalid yaml', () => {
    const r = parseConfig('teams: [unclosed');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.path).toBe('');
  });

  test('rejects empty members', () => {
    const r = parseConfig(toYaml([team({ members: [] })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'teams.0.members')).toBe(true);
  });

  test('rejects empty workdays', () => {
    const r = parseConfig(toYaml([team({ workdays: [] })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === 'teams.0.workdays')).toBe(true);
  });

  test('rejects unknown keys', () => {
    const r = parseConfig(toYaml([team({ bogus: 1 })]));
    expect(r.ok).toBe(false);
  });
});
