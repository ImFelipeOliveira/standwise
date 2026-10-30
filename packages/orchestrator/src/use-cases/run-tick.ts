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
  getInstallationMemberIds,
  listDailies,
  listOperationalInstallations,
  listPersonDeliveries,
  MAX_DELIVERY_ATTEMPTS,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { resolveTeams } from '../teams';
import { SCAN_MEMBER_SIGNALS_JOB, type ScanMemberSignalsJob } from './scan-member-signals';

type OperationalInstallation = Awaited<ReturnType<typeof listOperationalInstallations>>[number];

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
  installation: OperationalInstallation,
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
      (await listPersonDeliveries(deps.db, installation.id, date, 'reminder'))
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

const SCAN_LEAD_MINUTES = 60;
const SCAN_GRACE_MINUTES = 60;

export function scanTime(remindAt: string): string {
  const [hours, minutes] = remindAt.split(':').map(Number);
  const total = Math.max(0, (hours as number) * 60 + (minutes as number) - SCAN_LEAD_MINUTES);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function dueScanDates(now: Date, team: TeamConfig): string[] {
  const today = localDate(now, team.timezone);
  const yesterday = addCalendarDays(today, -1);
  const at = scanTime(team.remindAt);
  return [today, yesterday].filter(
    (date) => isWorkday(date, team) && isDue(now, date, at, team.timezone, SCAN_GRACE_MINUTES),
  );
}

async function enqueueScans(
  deps: WorkerDeps,
  installation: OperationalInstallation,
  team: TeamConfig,
  now: Date,
): Promise<void> {
  const dates = dueScanDates(now, team);
  if (dates.length === 0) return;
  const [resolved] = await resolveTeams(deps, installation.id, installation.accountLogin, {
    ...installation.config,
    teams: [team],
  });
  if (!resolved) return;
  const linked = await getInstallationMemberIds(deps.db, installation.id, resolved.memberLogins);
  for (const date of dates) {
    const scanned = new Set(
      (await listPersonDeliveries(deps.db, installation.id, date, 'signal_scan'))
        .filter((r) => r.status === 'sent')
        .map((r) => r.subject),
    );
    for (const login of resolved.memberLogins) {
      if (!linked.has(login) || scanned.has(login)) continue;
      const job: ScanMemberSignalsJob = { installationId: installation.id, login, date };
      await deps.queue.enqueue(SCAN_MEMBER_SIGNALS_JOB, job, {
        singletonKey: `scan:${installation.id}:${login}:${date}`,
      });
    }
  }
}

async function isolated(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const e = error as { name?: unknown; code?: unknown; message?: unknown };
    console.error(label, {
      name: String(e.name),
      code: String(e.code),
      message: String(e.message),
    });
  }
}

export async function runTick(deps: WorkerDeps): Promise<void> {
  const now = deps.now();
  for (const installation of await listOperationalInstallations(deps.db)) {
    for (const team of installation.config.teams) {
      await isolated('signal scan enqueue failed', () =>
        enqueueScans(deps, installation, team, now),
      );
      await isolated('reminder enqueue failed', () =>
        enqueueReminders(deps, installation, team, now),
      );
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
