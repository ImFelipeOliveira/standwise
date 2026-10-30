import { describe, expect, test } from 'bun:test';
import { activitySince } from '../src/activity';
import type { Calendar } from '../src/calendar';
import type { TeamConfig } from '../src/config';
import { clampTitle, DailySubmissionSchema, type ResolvedTeam, teamsForMember } from '../src/daily';

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

  test('caps ref titles at 200 characters', () => {
    const ref = { kind: 'pull_request', url: 'https://github.com/a/b/pull/1' };
    const ok = [{ text: 'x', ref: { ...ref, title: 'a'.repeat(200) } }];
    const long = [{ text: 'x', ref: { ...ref, title: 'a'.repeat(201) } }];
    expect(DailySubmissionSchema.safeParse({ ...valid, today: ok }).success).toBe(true);
    expect(DailySubmissionSchema.safeParse({ ...valid, today: long }).success).toBe(false);
  });

  test('rejects control, bidi and line separator characters in text and titles', () => {
    const ref = { kind: 'pull_request', url: 'https://github.com/a/b/pull/1' };
    const unsafe = [
      '\u0000',
      '\t',
      '\n',
      '\r',
      '\u001b',
      '\u007f',
      '\u0085',
      '\u009f',
      '\u202a',
      '\u202e',
      '\u2066',
      '\u2069',
      '\u2028',
      '\u2029',
    ];
    for (const char of unsafe) {
      const inText = [{ text: `a${char}b` }];
      const inTitle = [{ text: 'a', ref: { ...ref, title: `a${char}b` } }];
      expect(DailySubmissionSchema.safeParse({ ...valid, today: inText }).success).toBe(false);
      expect(DailySubmissionSchema.safeParse({ ...valid, blockers: inTitle }).success).toBe(false);
    }
  });

  test('rejects unsafe characters and non-http schemes in ref urls', () => {
    const urls = [
      'https://github.com/a/b/pull/1\u202e',
      'https://github.com/a/\u2066b/pull/1',
      'https://github.com/a/b\u0085/pull/1',
      'https://github.com/a/b/pull/1\u2028',
      'javascript:alert(1)',
      'ftp://github.com/a/b',
      'data:text/html,hi',
    ];
    for (const url of urls) {
      const today = [{ text: 'a', ref: { kind: 'pull_request', url } }];
      expect(DailySubmissionSchema.safeParse({ ...valid, today }).success).toBe(false);
    }
    for (const url of ['https://github.com/a/b/pull/1', 'http://localhost:3000/x']) {
      const today = [{ text: 'a', ref: { kind: 'pull_request', url } }];
      expect(DailySubmissionSchema.safeParse({ ...valid, today }).success).toBe(true);
    }
  });

  test('clampTitle strips unsafe characters and truncates to 200 characters', () => {
    expect(clampTitle('Fix\u202e bug\nnow\u2028')).toBe('Fix bugnow');
    const long = clampTitle('🙂'.repeat(250));
    expect(Array.from(long)).toHaveLength(200);
    expect(long.endsWith('🙂…')).toBe(true);
    expect(clampTitle('a'.repeat(200))).toBe('a'.repeat(200));
  });

  test('accepts plain spaces, accents and emoji', () => {
    const today = [{ text: 'Revisar os PRs do time, sem pressa 🙂 — ação' }];
    expect(DailySubmissionSchema.safeParse({ ...valid, today }).success).toBe(true);
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
