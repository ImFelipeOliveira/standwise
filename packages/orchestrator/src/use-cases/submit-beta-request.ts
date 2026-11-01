import { type BetaLocale, upsertBetaRequest } from '@standwise/db';
import { z } from 'zod';
import type { Deps } from '../deps';
import { DomainError } from './errors';

export const NOTIFY_BETA_REQUEST_JOB = 'notify-beta-request';

export type NotifyBetaRequestJob = { requestId: string };

export type SubmitBetaRequestOutcome = 'stored' | 'duplicate' | 'spam';

const single = z.string();

const schema = z.object({
  name: single.trim().min(1).max(120),
  email: single.trim().max(254).pipe(z.email()),
  team_size: z.enum(['3-5', '6-15', '16+']),
  chat: z.enum(['slack', 'google_chat', 'other']),
  tracker: z.enum(['linear', 'jira', 'github', 'other']),
});

function resolveLocale(value: unknown): BetaLocale {
  return value === 'pt-BR' ? 'pt-BR' : 'en';
}

export async function submitBetaRequest(
  deps: Pick<Deps, 'db' | 'queue' | 'now'>,
  form: Record<string, unknown>,
): Promise<{ outcome: SubmitBetaRequestOutcome; locale: BetaLocale }> {
  const locale = resolveLocale(form.locale);
  const honeypot = form.company_website;
  if (typeof honeypot === 'string' ? honeypot.length > 0 : honeypot !== undefined) {
    return { outcome: 'spam', locale };
  }
  const parsed = schema.safeParse(form);
  if (!parsed.success) {
    throw new DomainError('invalid_beta_request', 'invalid beta request', { locale });
  }
  const { name, email, team_size, chat, tracker } = parsed.data;
  const stored = await upsertBetaRequest(
    deps.db,
    { name, email, teamSize: team_size, chat, tracker, locale },
    deps.now(),
  );
  if (!stored) return { outcome: 'duplicate', locale };
  const job: NotifyBetaRequestJob = { requestId: stored.id };
  await deps.queue.enqueue(NOTIFY_BETA_REQUEST_JOB, job);
  return { outcome: 'stored', locale };
}
