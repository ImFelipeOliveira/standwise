import { describe, expect, test } from 'bun:test';
import { parseEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://localhost/x',
  PUBLIC_URL: 'https://api.standwise.dev',
  SUPPORT_EMAIL: 'help@standwise.dev',
  STANDWISE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'key',
  GITHUB_WEBHOOK_SECRET: 'whsec',
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'a-session-secret-of-length',
  SLACK_CLIENT_ID: 'sid',
  SLACK_CLIENT_SECRET: 'ssecret',
  LINEAR_CLIENT_ID: 'lid',
  LINEAR_CLIENT_SECRET: 'lsecret',
};

describe('parseEnv', () => {
  test('strips trailing slashes from PUBLIC_URL', () => {
    for (const raw of ['https://api.standwise.dev/', 'https://api.standwise.dev///']) {
      expect(parseEnv({ ...base, PUBLIC_URL: raw }).PUBLIC_URL).toBe('https://api.standwise.dev');
    }
    expect(parseEnv({ ...base, PUBLIC_URL: 'https://x.dev/base/' }).PUBLIC_URL).toBe(
      'https://x.dev/base',
    );
    expect(parseEnv(base).PUBLIC_URL).toBe('https://api.standwise.dev');
  });

  test('rejects a PUBLIC_URL that is not a url', () => {
    expect(() => parseEnv({ ...base, PUBLIC_URL: 'api.standwise.dev' })).toThrow();
  });
});
