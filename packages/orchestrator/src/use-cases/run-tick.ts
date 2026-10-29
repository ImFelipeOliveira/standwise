import { addCalendarDays, isDue, isWorkday, localDate, type TeamConfig } from '@standwise/core';
import { getDelivery, listOperationalInstallations, MAX_DELIVERY_ATTEMPTS } from '@standwise/db';
import type { WorkerDeps } from '../deps';

function dueDigestDate(now: Date, team: TeamConfig): string | null {
  const today = localDate(now, team.timezone);
  const yesterday = addCalendarDays(today, -1);
  for (const date of [today, yesterday]) {
    if (isWorkday(date, team) && isDue(now, date, team.digestAt, team.timezone)) return date;
  }
  return null;
}

export async function runTick(deps: WorkerDeps): Promise<void> {
  const now = deps.now();
  for (const installation of await listOperationalInstallations(deps.db)) {
    for (const team of installation.config.teams) {
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
