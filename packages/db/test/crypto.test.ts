import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../src/crypto';

describe('crypto', () => {
  test('crypto roundtrip', () => {
    const key = randomBytes(32);
    expect(decryptSecret(encryptSecret('xoxb-secret', key), key)).toBe('xoxb-secret');
  });

  test('decrypt with wrong key throws', () => {
    const blob = encryptSecret('xoxb-secret', randomBytes(32));
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
  });

  test('two encryptions differ', () => {
    const key = randomBytes(32);
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  test('truncated blob throws', () => {
    const key = randomBytes(32);
    const blob = Buffer.from(encryptSecret('x', key), 'base64');
    expect(() => decryptSecret(blob.subarray(0, 28).toString('base64'), key)).toThrow();
    expect(() => decryptSecret('', key)).toThrow();
  });
});
