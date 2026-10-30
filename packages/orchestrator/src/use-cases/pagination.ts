import { DomainError } from './errors';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export type Page<T> = { data: T[]; nextCursor: string | null };

export type Cursor = { date: string; id: string; i?: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function parseDay(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isDay(value)) throw new DomainError('invalid_request', `${name} must be YYYY-MM-DD`);
  return value;
}

export function parseLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new DomainError('invalid_request', `limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return value;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(
  raw: string | undefined,
  kind: 'page' | 'item' = 'page',
): Cursor | undefined {
  if (raw === undefined) return undefined;
  const invalid = () => new DomainError('invalid_request', 'cursor is not valid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid();
  const { date, id, i, ...rest } = parsed as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw invalid();
  if (typeof date !== 'string' || !isDay(date)) throw invalid();
  if (typeof id !== 'string' || !isUuid(id)) throw invalid();
  if (kind === 'page') {
    if (i !== undefined) throw invalid();
    return { date, id };
  }
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) throw invalid();
  return { date, id, i };
}

export function paginate<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): Page<T> {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}
