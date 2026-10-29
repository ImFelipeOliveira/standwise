import { decryptSecret, encryptSecret } from '@standwise/db';
import { hashSessionToken } from '@standwise/orchestrator';
import type { NewApiKey } from './setup';

export const FLASH_COOKIE = 'sw_flash';
export const FLASH_PATH = '/setup';
export const FLASH_SECONDS = 60;

type Flash = NewApiKey & { installationId: number; session: string };

export function sealFlash(
  encryptionKey: Uint8Array,
  sessionToken: string,
  installationId: number,
  newKey: NewApiKey,
): string {
  const flash: Flash = { ...newKey, installationId, session: hashSessionToken(sessionToken) };
  return encryptSecret(JSON.stringify(flash), encryptionKey);
}

export function openFlash(
  encryptionKey: Uint8Array,
  sessionToken: string,
  installationId: number,
  raw: string,
): NewApiKey | undefined {
  try {
    const value = JSON.parse(decryptSecret(raw, encryptionKey)) as Partial<Flash>;
    const valid =
      typeof value.name === 'string' &&
      typeof value.key === 'string' &&
      value.installationId === installationId &&
      value.session === hashSessionToken(sessionToken);
    return valid ? { name: value.name as string, key: value.key as string } : undefined;
  } catch {
    return undefined;
  }
}
