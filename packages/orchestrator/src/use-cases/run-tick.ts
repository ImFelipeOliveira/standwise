import {
  addCalendarDays,
  isDue,
  isWorkday,
  localDate,
  localInstant,
  type TeamConfig,
} from '@standwise/core';
import {
  getDelivery,
  listDailies,
  listOperationalInstallations,
  listReminderDeliveries,
  MAX_DELIVERY_ATTEMPTS,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { resolveTeams } from '../teams';

function dueDigestDate(now: Date, team: TeamConfig): string | null {
  const today = localDate(now, team.timezone);
  const yesterday = addCalendarDays(today, -1);
  for (const date of [today, yesterday]) {
    if (isWorkday(date, team) && isDue(now, date, team.digestAt, team.timezone)) return date;
  }
  return null;
}

const REMINDER_GRACE_MINUTES = 60;

function dueReminderDates(now: Date, team: TeamConfig): string[] {
  const today = localDate(now, team.timezone);
  const yesterday = addCalendarDays(today, -1);
  return [today, yesterday].filter(
    (date) =>
      isWorkday(date, team) &&
      now.getTime() < localInstant(date, team.digestAt, team.timezone).getTime() &&
      isDue(now, date, team.remindAt, team.timezone, REMINDER_GRACE_MINUTES),
  );
}

async function enqueueReminders(
  deps: WorkerDeps,
  installation: Awaited<ReturnType<typeof listOperationalInstallations>>[number],
  team: TeamConfig,
  now: Date,
): Promise<void> {
  for (const date of dueReminderDates(now, team)) {
    const digest = await getDelivery(deps.db, {
      installationId: installation.id,
      teamName: team.name,
      date,
      kind: 'digest',
    });
    if (digest?.status === 'sent') continue;
    const [resolved] = await resolveTeams(deps, installation.id, installation.accountLogin, {
      ...installation.config,
      teams: [team],
    });
    if (!resolved) continue;
    const submitted = new Set(
      (await listDailies(deps.db, installation.id, date)).map((d) => d.login.toLowerCase()),
    );
    const settled = new Set(
      (await listReminderDeliveries(deps.db, installation.id, date))
        .filter(
          (r) =>
            r.status === 'sent' || (r.status === 'failed' && r.attempts >= MAX_DELIVERY_ATTEMPTS),
        )
        .map((r) => r.subject),
    );
    for (const login of resolved.memberLogins) {
      if (submitted.has(login) || settled.has(login)) continue;
      await deps.queue.enqueue(
        'send-reminder',
        { installationId: installation.id, login, date },
        { singletonKey: `reminder:${installation.id}:${login}:${date}` },
      );
    }
  }
}

export async function runTick(deps: WorkerDeps): Promise<void> {
  const now = deps.now();
  for (const installation of await listOperationalInstallations(deps.db)) {
    for (const team of installation.config.teams) {
      try {
        await enqueueReminders(deps, installation, team, now);
      } catch (error) {
        const e = error as { name?: unknown; code?: unknown; message?: unknown };
        console.error('reminder enqueue failed', {
          name: String(e.name),
          code: String(e.code),
          message: String(e.message),
        });
      }
      const date = dueDigestDate(now, team);
      if (!date) continue;
      const delivery = await getDelivery(deps.db, {
        installationId: installation.id,
        teamName: team.name,
        date,
        kind: 'digest',
      });
      if (delivery?.status === 'sent') continue;
      if (delivery?.status === 'failed' && delivery.attempts >= MAX_DELIVERY_ATTEMPTS) continue;
      await deps.queue.enqueue(
        'send-digest',
        { installationId: installation.id, teamName: team.name, date },
        { singletonKey: `digest:${installation.id}:${team.name}:${date}` },
      );
    }
  }
}
