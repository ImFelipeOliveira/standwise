import { type Calendar, previousWorkday, startOfLocalDay } from './calendar';

export type ActivityItem = {
  kind: 'pr_opened' | 'pr_merged' | 'review' | 'commits';
  title: string;
  url: string;
  repo: string;
  at: Date;
  count?: number;
};

/** Start of the window of GitHub activity to summarize for the daily of `date`. */
export function activitySince(input: {
  date: string;
  cal: Calendar;
  lastDaily?: { date: string; submittedAt: Date };
}): Date {
  const previous = previousWorkday(input.date, input.cal);
  if (input.lastDaily && input.lastDaily.date >= previous) return input.lastDaily.submittedAt;
  return startOfLocalDay(previous, input.cal.timezone);
}
