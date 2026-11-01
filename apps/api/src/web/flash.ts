import { decryptSecret, encryptSecret } from '@standcast/db';
import { hashSessionToken } from '@standcast/orchestrator';
import type { NewApiKey, NewWebhook } from './setup';

export const FLASH_COOKIE = 'sc_flash';
export const FLASH_PATH = '/setup';
export const FLASH_SECONDS = 60;

export type FlashValue = ({ kind: 'apiKey' } & NewApiKey) | ({ kind: 'webhook' } & NewWebhook);

type Flash = FlashValue & { installationId: number; session: string };

export function sealFlash(
  encryptionKey: Uint8Array,
  sessionToken: string,
  installationId: number,
  value: FlashValue,
): string {
  const flash: Flash = { ...value, installationId, session: hashSessionToken(sessionToken) };
  return encryptSecret(JSON.stringify(flash), encryptionKey);
}

function toValue(value: Partial<Record<string, unknown>>): FlashValue | undefined {
  if (value.kind === 'apiKey' && typeof value.name === 'string' && typeof value.key === 'string') {
    return { kind: 'apiKey', name: value.name, key: value.key };
  }
  if (
    value.kind === 'webhook' &&
    typeof value.url === 'string' &&
    typeof value.secret === 'string'
  ) {
    return { kind: 'webhook', url: value.url, secret: value.secret };
  }
  return undefined;
}

export function openFlash(
  encryptionKey: Uint8Array,
  sessionToken: string,
  installationId: number,
  raw: string,
): FlashValue | undefined {
  try {
    const value = JSON.parse(decryptSecret(raw, encryptionKey)) as Partial<Flash>;
    const bound =
      value.installationId === installationId && value.session === hashSessionToken(sessionToken);
    return bound ? toValue(value) : undefined;
  } catch {
    return undefined;
  }
}
