import {
  deleteExpiredSessions,
  deletePersonDeliveriesBefore,
  deleteResolvedSuggestionsBefore,
  deleteWebhookDeliveriesBefore,
} from '@standwise/db';
import type { WorkerDeps } from '../deps';

export const PRUNE_DATA_JOB = 'prune-data';
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
const SUGGESTION_RETENTION_DAYS = 90;
const PERSON_DELIVERY_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PruneResult = {
  webhookDeliveries: number;
  sessions: number;
  suggestions: number;
  personDeliveries: number;
};

export async function pruneData(deps: Pick<WorkerDeps, 'db' | 'now'>): Promise<PruneResult> {
  const now = deps.now();
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    webhookDeliveries: await deleteWebhookDeliveriesBefore(
      deps.db,
      daysAgo(WEBHOOK_DELIVERY_RETENTION_DAYS),
    ),
    sessions: await deleteExpiredSessions(deps.db, now),
    suggestions: await deleteResolvedSuggestionsBefore(deps.db, daysAgo(SUGGESTION_RETENTION_DAYS)),
    personDeliveries: await deletePersonDeliveriesBefore(
      deps.db,
      daysAgo(PERSON_DELIVERY_RETENTION_DAYS),
    ),
  };
}
