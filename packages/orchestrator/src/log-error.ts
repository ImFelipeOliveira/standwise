import { errorFields } from '@standcast/core';

export { errorFields };

export function logError(label: string, error: unknown, extra: Record<string, string> = {}): void {
  console.error(label, { ...extra, ...errorFields(error) });
}
