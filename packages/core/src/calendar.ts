import { TZDate } from '@date-fns/tz';
import { addDays, format, subDays } from 'date-fns';
import type { TeamConfig, Weekday } from './config';

export type Calendar = Pick<TeamConfig, 'timezone' | 'workdays'>;

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_STEPS = 7;

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y as number, m as number, d as number];
}

function plain(date: string): Date {
  const [y, m, d] = parseDate(date);
  return new Date(y, m - 1, d, 12);
}

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

export function localDate(now: Date, tz: string): string {
  return format(new TZDate(now, tz), 'yyyy-MM-dd');
}

export function addCalendarDays(date: string, days: number): string {
  return fmt(addDays(plain(date), days));
}

export function isWorkday(date: string, cal: Calendar): boolean {
  const day = WEEKDAYS[plain(date).getDay()] as Weekday;
  return cal.workdays.includes(day);
}

function walk(
  date: string,
  cal: Calendar,
  step: (d: Date, n: number) => Date,
  includeStart: boolean,
): string {
  const start = plain(date);
  for (let i = includeStart ? 0 : 1; i <= MAX_STEPS; i++) {
    const candidate = fmt(step(start, i));
    if (isWorkday(candidate, cal)) return candidate;
  }
  throw new Error('no workdays');
}

export function dailyDateFor(now: Date, cal: Calendar): string {
  return walk(localDate(now, cal.timezone), cal, addDays, true);
}

export function previousWorkday(date: string, cal: Calendar): string {
  return walk(date, cal, subDays, false);
}

export function startOfLocalDay(date: string, tz: string): Date {
  const [y, m, d] = parseDate(date);
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, 0, tz).getTime());
}

export function isDue(
  now: Date,
  date: string,
  hhmm: string,
  tz: string,
  graceMinutes = 120,
): boolean {
  const [y, m, d] = parseDate(date);
  const [h, min] = hhmm.split(':').map(Number);
  const start = new TZDate(y, m - 1, d, h as number, min as number, 0, 0, tz).getTime();
  const elapsed = Math.floor((now.getTime() - start) / 60_000);
  return elapsed >= 0 && elapsed <= graceMinutes;
}
