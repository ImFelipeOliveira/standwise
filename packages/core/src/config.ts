import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Language = 'pt-BR' | 'en';

export type TeamConfig = {
  name: string;
  timezone: string;
  workdays: Weekday[];
  remindAt: string;
  digestAt: string;
  language: Language;
  managers: string[];
  members: string[];
  chat: { provider: 'slack' | 'google-chat'; channel: string };
  tracker?: { provider: 'linear' | 'jira'; team: string };
  signals: { prReviewHours: number; cardStaleDays: number };
};

export type MemberOverrides = {
  slack?: string;
  googleChat?: string;
  linear?: string;
  jira?: string;
};

export type StandwiseConfig = {
  teams: TeamConfig[];
  members: Record<string, MemberOverrides>;
};

export type ConfigError = { path: string; message: string };

export type ParseConfigResult =
  | { ok: true; config: StandwiseConfig }
  | { ok: false; errors: ConfigError[] };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24h)');

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA timezone');

const weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const login = z.string().min(1);

const teamSchema = z.strictObject({
  name: z.string().min(1),
  timezone,
  workdays: z.array(weekday).min(1).default(['mon', 'tue', 'wed', 'thu', 'fri']),
  remind_at: time,
  digest_at: time,
  language: z.enum(['pt-BR', 'en']).default('en'),
  managers: z.array(login).min(1),
  members: z.array(login).min(1),
  chat: z.strictObject({
    provider: z.enum(['slack', 'google-chat']),
    channel: z.string().min(1),
  }),
  tracker: z
    .strictObject({
      provider: z.enum(['linear', 'jira']),
      team: z.string().min(1),
    })
    .optional(),
  signals: z
    .strictObject({
      pr_review_hours: z.number().positive().default(48),
      card_stale_days: z.number().positive().default(5),
    })
    .default({ pr_review_hours: 48, card_stale_days: 5 }),
});

const overridesSchema = z.strictObject({
  slack: z.string().optional(),
  google_chat: z.string().optional(),
  linear: z.string().optional(),
  jira: z.string().optional(),
});

const configSchema = z
  .strictObject({
    teams: z.array(teamSchema).min(1),
    members: z.record(z.string(), overridesSchema).default({}),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.teams.forEach((t, i) => {
      if (seen.has(t.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['teams', i, 'name'],
          message: `duplicate team name "${t.name}"`,
        });
      }
      seen.add(t.name);
    });
  });

type RawConfig = z.output<typeof configSchema>;

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function toConfig(raw: RawConfig): StandwiseConfig {
  return {
    teams: raw.teams.map((t) => {
      const team: TeamConfig = {
        name: t.name,
        timezone: t.timezone,
        workdays: t.workdays,
        remindAt: t.remind_at,
        digestAt: t.digest_at,
        language: t.language,
        managers: t.managers,
        members: t.members,
        chat: t.chat,
        signals: {
          prReviewHours: t.signals.pr_review_hours,
          cardStaleDays: t.signals.card_stale_days,
        },
      };
      if (t.tracker) team.tracker = t.tracker;
      return team;
    }),
    members: Object.fromEntries(
      Object.entries(raw.members).map(([k, v]) => [
        k,
        compact({ slack: v.slack, googleChat: v.google_chat, linear: v.linear, jira: v.jira }),
      ]),
    ),
  };
}

export function parseConfig(source: string): ParseConfigResult {
  let data: unknown;
  try {
    data = parseYaml(source);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: (e as Error).message }] };
  }
  const result = configSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  }
  return { ok: true, config: toConfig(result.data) };
}
