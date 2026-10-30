import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { signWebhook, verifyWebhookSignature } from '../src';

const SECRET = 'whsec_test-secret';
const BODY = '{"id":"evt","type":"daily.submitted"}';
const T = 1_793_200_000;

describe('webhook signature', () => {
  test('signature roundtrip', () => {
    const header = signWebhook(SECRET, BODY, T);
    expect(verifyWebhookSignature(SECRET, BODY, header, T)).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, header, T + 299)).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, header, T - 299)).toBe(true);
    expect(verifyWebhookSignature(SECRET, `${BODY} `, header, T)).toBe(false);
    expect(verifyWebhookSignature('whsec_other', BODY, header, T)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, T + 301)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, T - 301)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, T + 3600, 7200)).toBe(true);
  });

  test('header format is t=<seconds>,v1=<hex hmac-sha256 of t.body>', () => {
    const expected = createHmac('sha256', SECRET).update(`${T}.${BODY}`).digest('hex');
    expect(signWebhook(SECRET, BODY, T)).toBe(`t=${T},v1=${expected}`);
  });

  test('rejects malformed headers', () => {
    const valid = signWebhook(SECRET, BODY, T);
    const v1 = valid.split(',v1=')[1] ?? '';
    for (const header of [
      '',
      'garbage',
      `t=${T}`,
      `v1=${v1}`,
      `t=abc,v1=${v1}`,
      `t=${T},v1=${v1.slice(0, -2)}`,
      `t=${T},v1=${v1.toUpperCase()}x`,
      `t=${T}.5,v1=${v1}`,
    ]) {
      expect(verifyWebhookSignature(SECRET, BODY, header, T)).toBe(false);
    }
  });

  test('accepts any matching v1 among several and ignores unknown schemes', () => {
    const valid = signWebhook(SECRET, BODY, T);
    const v1 = valid.split(',v1=')[1] ?? '';
    const header = `t=${T},v0=abc,v1=${'0'.repeat(64)},v1=${v1}`;
    expect(verifyWebhookSignature(SECRET, BODY, header, T)).toBe(true);
  });
});
