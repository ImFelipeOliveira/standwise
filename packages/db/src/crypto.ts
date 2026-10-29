import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptSecret(plain: string, key: Uint8Array): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptSecret(blob: string, key: Uint8Array): string {
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < IV_LENGTH + TAG_LENGTH + 1) throw new Error('invalid encrypted secret');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)),
    decipher.final(),
  ]).toString('utf8');
}
