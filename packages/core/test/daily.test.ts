import { describe, expect, test } from 'bun:test';
import { activitySince } from '../src/activity';
import type { Calendar } from '../src/calendar';
import type { TeamConfig } from '../src/config';
import { DailySubmissionSchema, type ResolvedTeam, teamsForMember } from '../src/daily';

const valid = {
  org: 'acme',
  yesterday: [{ text: 'did a thing' }],
  today: [{ text: 'do a thing' }],
  blockers: [],
};

const cal: Calendar = {
  timezone: 'America/Sao_Paulo',
  workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
};

function team(name: string, memberLogins: string[]): ResolvedTeam {
  return { name, memberLogins } as unknown as TeamConfig & { memberLogins: string[] };
}

describe('DailySubmissionSchema', () => {
  test('accepts a valid submission', () => {
    expect(DailySubmissionSchema.safeParse(valid).success).toBe(true);
  });

  test('schema requires today', () => {
    expect(DailySubmissionSchema.safeParse({ ...valid, today: [] }).success).toBe(false);
  });

  test('rejects text over 500 chars', () => {
    const today = [{ text: 'x'.repeat(501) }];
    expect(DailySubmissionSchema.safeParse({ ...valid, today }).success).toBe(false);
  });

  test('rejects invalid ref url', () => {
    const today = [{ text: 'ok', ref: { kind: 'pull_request', url: 'not a url' } }];
    expect(DailySubmissionSchema.safeParse({ ...valid, today }).success).toBe(false);
  });

  test('rejects empty org', () => {
    expect(DailySubmissionSchema.safeParse({ ...valid, org: '' }).success).toBe(false);
  });
});

describe('teamsForMember', () => {
  test('teamsForMember order and case', () => {
    const teams = [team('backend', ['alice']), team('web', ['bob']), team('platform', ['alice'])];
    expect(teamsForMember('Alice', teams).map((t) => t.name)).toEqual(['backend', 'platform']);
  });
});

describe('activitySince', () => {
  test('activitySince uses last daily', () => {
    const submittedAt = new Date('2026-10-27T12:10:00Z');
    const lastDaily = { date: '2026-10-27', submittedAt };
    expect(activitySince({ date: '2026-10-28', cal, lastDaily })).toEqual(submittedAt);
  });

  test('activitySince ignores stale daily', () => {
    const lastDaily = { date: '2026-10-18', submittedAt: new Date('2026-10-18T12:10:00Z') };
    expect(activitySince({ date: '2026-10-28', cal, lastDaily })).toEqual(
      new Date('2026-10-27T03:00:00Z'),
    );
  });

  test('without a last daily starts at the previous workday', () => {
    expect(activitySince({ date: '2026-10-28', cal })).toEqual(new Date('2026-10-27T03:00:00Z'));
  });
});
