import { z } from 'zod';
import type { TeamConfig } from './config';

function isUnsafeChar(code: number): boolean {
  const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  return control || bidi || code === 0x2028 || code === 0x2029;
}

export function hasUnsafeChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isUnsafeChar(text.charCodeAt(i))) return true;
  }
  return false;
}

const safe = (schema: z.ZodString) =>
  schema.refine((value) => !hasUnsafeChars(value), {
    message: 'must not contain control, bidi or line separator characters',
  });

const RefSchema = z.object({
  kind: z.enum(['pull_request', 'issue', 'commit', 'card']),
  url: z.url(),
  title: safe(z.string().max(200)).optional(),
});

const ItemSchema = z.object({
  text: safe(z.string().min(1).max(500)),
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
export type DailyConfirmation = 'agent' | 'human';
export type StoredDaily = DailySubmission & { confirmation?: DailyConfirmation };

export type ResolvedTeam = TeamConfig & { memberLogins: string[] };

export function teamsForMember(login: string, teams: ResolvedTeam[]): ResolvedTeam[] {
  const wanted = login.toLowerCase();
  return teams.filter((t) => t.memberLogins.includes(wanted));
}
