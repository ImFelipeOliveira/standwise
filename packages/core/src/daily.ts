import { z } from 'zod';
import type { TeamConfig } from './config';

const RefSchema = z.object({
  kind: z.enum(['pull_request', 'issue', 'commit', 'card']),
  url: z.url(),
  title: z.string().optional(),
});

const ItemSchema = z.object({
  text: z.string().min(1).max(500),
  ref: RefSchema.optional(),
});

export const DailySubmissionSchema = z.object({
  org: z.string().min(1),
  yesterday: z.array(ItemSchema).max(30),
  today: z.array(ItemSchema).min(1).max(30),
  blockers: z.array(ItemSchema).max(10),
});

export type Ref = z.infer<typeof RefSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type DailySubmission = z.infer<typeof DailySubmissionSchema>;

/** Team with "@org/slug" members already expanded; logins are lowercase. */
export type ResolvedTeam = TeamConfig & { memberLogins: string[] };

/** Teams the login belongs to, in config order, case-insensitive. */
export function teamsForMember(login: string, teams: ResolvedTeam[]): ResolvedTeam[] {
  const wanted = login.toLowerCase();
  return teams.filter((t) => t.memberLogins.includes(wanted));
}
