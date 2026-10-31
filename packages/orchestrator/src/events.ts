import { createHash } from 'node:crypto';
import type { Item, Ref } from '@standwise/core';

export type DailySubmittedData = {
  id: string;
  login: string;
  date: string;
  teams: string[];
  yesterday: Item[];
  today: Item[];
  blockers: Item[];
  replaced: boolean;
};

export type BlockerOpenedData = {
  dailyId: string;
  login: string;
  date: string;
  text: string;
  ref?: Ref;
  teams: string[];
};

export type DigestSentData = {
  team: string;
  date: string;
  submitted: string[];
  missing: string[];
};

export type PingData = { endpoint_id: string };

export type WebhookEvent =
  | { type: 'daily.submitted'; data: DailySubmittedData }
  | { type: 'blocker.opened'; data: BlockerOpenedData }
  | { type: 'digest.sent'; data: DigestSentData };

export type DeliverableEvent = WebhookEvent | { type: 'ping'; data: PingData };

export type Envelope = {
  id: string;
  type: DeliverableEvent['type'];
  created_at: string;
  installation: { id: number; login: string };
  data: DeliverableEvent['data'];
};

export function normalizeBlockerText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function blockerHash(blocker: Item): string {
  return createHash('sha256').update(normalizeBlockerText(blocker.text)).digest('hex').slice(0, 32);
}

const CASE_INSENSITIVE_PATH_HOSTS = new Set(['github.com', 'linear.app']);

export function normalizeRefUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.host.toLowerCase();
    const rawPath = parsed.pathname.replace(/\/+$/, '');
    const path = CASE_INSENSITIVE_PATH_HOSTS.has(parsed.hostname.toLowerCase())
      ? rawPath.toLowerCase()
      : rawPath;
    return `${parsed.protocol}//${host}${path}`;
  } catch {
    return trimmed;
  }
}

function routeKey(blocker: Item): string {
  return blocker.ref?.url
    ? `ref:${normalizeRefUrl(blocker.ref.url)}`
    : `text:${normalizeBlockerText(blocker.text)}`;
}

export function blockerRouteId(blocker: Item): string {
  if (!blocker.ref?.url) return blockerHash(blocker);
  return createHash('sha256').update(normalizeRefUrl(blocker.ref.url)).digest('hex').slice(0, 32);
}

export function newRoutedBlockers(previous: Item[] | undefined, current: Item[]): Item[] {
  const seen = new Set((previous ?? []).map(routeKey));
  const fresh: Item[] = [];
  for (const blocker of current) {
    const key = routeKey(blocker);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(blocker);
  }
  return fresh;
}

export function newBlockers(previous: Item[] | undefined, current: Item[]): Item[] {
  const seen = new Set((previous ?? []).map((b) => normalizeBlockerText(b.text)));
  const fresh: Item[] = [];
  for (const blocker of current) {
    const key = normalizeBlockerText(blocker.text);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(blocker);
  }
  return fresh;
}
