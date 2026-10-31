import { type Calendar, previousWorkday, startOfLocalDay } from './calendar';

export type ActivityItem = {
  kind: 'pr_opened' | 'pr_merged' | 'review' | 'commits' | 'card_started' | 'card_done';
  title: string;
  url: string;
  repo: string;
  at: Date;
  count?: number;
};

export function activitySince(input: {
  date: string;
  cal: Calendar;
  lastDaily?: { date: string; submittedAt: Date };
}): Date {
  const previous = previousWorkday(input.date, input.cal);
  if (input.lastDaily && input.lastDaily.date >= previous) return input.lastDaily.submittedAt;
  return startOfLocalDay(previous, input.cal.timezone);
}
