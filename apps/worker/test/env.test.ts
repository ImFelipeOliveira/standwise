import { describe, expect, test } from 'bun:test';
import { parseEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://x',
  STANDWISE_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'k',
  GITHUB_WEBHOOK_SECRET: 's',
  GITHUB_CLIENT_ID: 'c',
  GITHUB_CLIENT_SECRET: 's',
  LINEAR_CLIENT_ID: 'c',
  LINEAR_CLIENT_SECRET: 's',
};

describe('worker env', () => {
  test('parses without resend variables', () => {
    expect(() => parseEnv(base)).not.toThrow();
  });

  test('fails when RESEND_API_KEY is set without BETA_EMAIL_FROM', () => {
    expect(() => parseEnv({ ...base, RESEND_API_KEY: 'r', SUPPORT_EMAIL: 'a@b.c' })).toThrow();
  });

  test('fails when RESEND_API_KEY is set without SUPPORT_EMAIL', () => {
    expect(() => parseEnv({ ...base, RESEND_API_KEY: 'r', BETA_EMAIL_FROM: 'a@b.c' })).toThrow();
  });

  test('parses with all three set', () => {
    expect(() =>
      parseEnv({
        ...base,
        RESEND_API_KEY: 'r',
        BETA_EMAIL_FROM: 'a@b.c',
        SUPPORT_EMAIL: 's@b.c',
      }),
    ).not.toThrow();
  });
});
