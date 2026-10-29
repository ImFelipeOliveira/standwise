import { ChatDeliveryError } from '@standwise/slack';

export function describeDeliveryError(error: unknown): string {
  if (error instanceof ChatDeliveryError) return `${error.code}: ${error.message}`;
  return `internal_error: ${error instanceof Error ? error.message : String(error)}`;
}
