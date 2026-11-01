import type { ActivityItem, CardSnapshot } from '@standcast/core';
import { z } from 'zod';
import type { LinearClient } from './client';

const ACTIVITY_QUERY = `query CardActivity($userId: ID!, $teamKey: String!, $since: DateTimeOrDuration!) {
  issues(
    filter: {
      assignee: { id: { eq: $userId } }
      team: { key: { eq: $teamKey } }
      updatedAt: { gte: $since }
    }
    first: 50
    orderBy: updatedAt
  ) {
    nodes { id identifier url title startedAt completedAt }
  }
}`;

export const STALE_PAGE_SIZE = 50;

export type StaleCards = { cards: CardSnapshot[]; truncated: boolean };

const STALE_QUERY = `query StaleInProgress($userId: ID!, $teamKey: String!) {
  issues(
    filter: {
      assignee: { id: { eq: $userId } }
      team: { key: { eq: $teamKey } }
      state: { type: { eq: "started" } }
    }
    first: ${STALE_PAGE_SIZE}
  ) {
    nodes { id identifier url title startedAt }
  }
}`;

const dateField = z
  .string()
  .nullish()
  .transform((v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

const activityNode = z.object({
  url: z.string().min(1),
  title: z.string(),
  startedAt: dateField,
  completedAt: dateField,
});

const staleNode = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  startedAt: dateField,
});

function nodesOf(data: unknown): unknown[] {
  const nodes = (data as { issues?: { nodes?: unknown } } | null)?.issues?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

export async function listCardActivity(
  client: LinearClient,
  input: { userId: string; teamKey: string; since: Date },
): Promise<ActivityItem[]> {
  const data = await client.query<unknown>(ACTIVITY_QUERY, {
    userId: input.userId,
    teamKey: input.teamKey,
    since: input.since.toISOString(),
  });
  const items: ActivityItem[] = [];
  for (const raw of nodesOf(data)) {
    const parsed = activityNode.safeParse(raw);
    if (!parsed.success) continue;
    const { url, title, startedAt, completedAt } = parsed.data;
    const base = { title, url, repo: input.teamKey };
    if (completedAt && completedAt >= input.since) {
      items.push({ kind: 'card_done', ...base, at: completedAt });
    } else if (startedAt && startedAt >= input.since) {
      items.push({ kind: 'card_started', ...base, at: startedAt });
    }
  }
  return items;
}

export async function listStaleInProgress(
  client: LinearClient,
  input: { userId: string; teamKey: string },
): Promise<StaleCards> {
  const data = await client.query<unknown>(STALE_QUERY, {
    userId: input.userId,
    teamKey: input.teamKey,
  });
  const nodes = nodesOf(data);
  const cards: CardSnapshot[] = [];
  for (const raw of nodes) {
    const parsed = staleNode.safeParse(raw);
    if (!parsed.success || !parsed.data.startedAt) continue;
    const { id, identifier, url, title, startedAt } = parsed.data;
    cards.push({ id, identifier, url, title, startedAt });
  }
  return { cards, truncated: nodes.length >= STALE_PAGE_SIZE };
}
