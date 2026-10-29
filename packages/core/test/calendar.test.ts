import { describe, expect, test } from 'bun:test';
import {
  type Calendar,
  dailyDateFor,
  isDue,
  isWorkday,
  localDate,
  previousWorkday,
  startOfLocalDay,
} from '../src/calendar';

const cal: Calendar = {
  timezone: 'America/Sao_Paulo',
  workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
};

describe('calendar', () => {
  test('localDate near midnight', () => {
    expect(localDate(new Date('2026-10-28T02:30:00Z'), 'America/Boa_Vista')).toBe('2026-10-27');
  });

  test('saturday counts for monday', () => {
    expect(dailyDateFor(new Date('2026-10-31T15:00:00Z'), cal)).toBe('2026-11-02');
    expect(dailyDateFor(new Date('2026-10-28T15:00:00Z'), cal)).toBe('2026-10-28');
  });

  test('previousWorkday skips weekend', () => {
    expect(previousWorkday('2026-11-02', cal)).toBe('2026-10-30');
  });

  test('custom workdays', () => {
    const c: Calendar = { ...cal, workdays: ['sun', 'mon', 'tue', 'wed', 'thu'] };
    expect(isWorkday('2026-11-01', c)).toBe(true);
    expect(isWorkday('2026-11-01', cal)).toBe(false);
  });

  test('no workdays throws', () => {
    const c: Calendar = { ...cal, workdays: [] };
    expect(() => previousWorkday('2026-11-02', c)).toThrow('no workdays');
    expect(() => dailyDateFor(new Date('2026-10-31T15:00:00Z'), c)).toThrow('no workdays');
  });

  test('startOfLocalDay across DST', () => {
    expect(startOfLocalDay('2026-11-01', 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
  });

  test('isDue window', () => {
    const tz = 'America/Sao_Paulo';
    const at = (t: string) => new Date(`2026-10-28T${t}:00-03:00`);
    expect(isDue(at('09:59'), '2026-10-28', '10:00', tz)).toBe(false);
    expect(isDue(at('10:00'), '2026-10-28', '10:00', tz)).toBe(true);
    expect(isDue(at('11:59'), '2026-10-28', '10:00', tz)).toBe(true);
    expect(isDue(at('12:01'), '2026-10-28', '10:00', tz)).toBe(false);
    expect(isDue(at('10:30'), '2026-10-29', '10:00', tz)).toBe(false);
  });

  test('isDue grace crosses midnight', () => {
    const tz = 'America/Sao_Paulo';
    expect(isDue(new Date('2026-10-29T00:15:00-03:00'), '2026-10-28', '23:30', tz)).toBe(true);
    expect(isDue(new Date('2026-10-29T01:31:00-03:00'), '2026-10-28', '23:30', tz)).toBe(false);
    expect(isDue(new Date('2026-10-29T00:15:00-03:00'), '2026-10-29', '23:30', tz)).toBe(false);
  });
});
