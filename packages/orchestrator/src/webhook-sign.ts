import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

const digest = (secret: string, body: string, t: number) =>
  createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

export function signWebhook(secret: string, body: string, t: number): string {
  return `t=${t},v1=${digest(secret, body, t)}`;
}

function parseHeader(header: string): { t: number; signatures: string[] } | null {
  let t: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index < 0) return null;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't') {
      if (t !== null || !/^\d{1,12}$/.test(value)) return null;
      t = Number(value);
    } else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) {
      signatures.push(value);
    }
  }
  return t === null || signatures.length === 0 ? null : { t, signatures };
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  now: number,
  toleranceSeconds: number = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parsed = parseHeader(header);
  if (!parsed || Math.abs(now - parsed.t) > toleranceSeconds) return false;
  const expected = Buffer.from(digest(secret, body, parsed.t), 'hex');
  let match = false;
  for (const signature of parsed.signatures) {
    if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) match = true;
  }
  return match;
}
