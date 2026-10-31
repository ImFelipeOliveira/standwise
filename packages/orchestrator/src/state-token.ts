import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

export type LoginState = { kind: 'login'; next: string; nonceHash: string };
export type SlackState = { kind: 'slack'; installationId: number; sessionHash: string };
export type LinearState = { kind: 'linear'; installationId: number; sessionHash: string };
export type StatePayload = LoginState | SlackState | LinearState;

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64url');

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const hashSessionToken = sha256;
export const hashNonce = sha256;

export function newNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signState(secret: string, payload: StatePayload, now: Date): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now.getTime() + STATE_TTL_MS }),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

function isLoginState(value: Record<string, unknown>): value is LoginState {
  return (
    value.kind === 'login' && typeof value.next === 'string' && typeof value.nonceHash === 'string'
  );
}

function isConnectState(value: Record<string, unknown>): value is SlackState | LinearState {
  return (
    (value.kind === 'slack' || value.kind === 'linear') &&
    Number.isInteger(value.installationId) &&
    typeof value.installationId === 'number' &&
    typeof value.sessionHash === 'string'
  );
}

export function verifyState<K extends StatePayload['kind']>(
  secret: string,
  token: string,
  kind: K,
  now: Date,
): Extract<StatePayload, { kind: K }> | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.exp !== 'number' || value.exp < now.getTime()) return null;
  if (value.kind !== kind) return null;
  const valid = isLoginState(value) || isConnectState(value);
  return valid ? (value as Extract<StatePayload, { kind: K }>) : null;
}
