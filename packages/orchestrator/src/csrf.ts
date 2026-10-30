import { createHmac } from 'node:crypto';
import { hashesMatch, hashSessionToken } from './state-token';

export function csrfToken(secret: string, sessionToken: string): string {
  return createHmac('sha256', secret)
    .update(`csrf:${hashSessionToken(sessionToken)}`)
    .digest('base64url');
}

export function verifyCsrf(secret: string, sessionToken: string, candidate: unknown): boolean {
  return typeof candidate === 'string' && hashesMatch(csrfToken(secret, sessionToken), candidate);
}
