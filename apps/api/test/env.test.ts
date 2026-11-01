import { describe, expect, test } from 'bun:test';
import { parseEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://localhost/x',
  PUBLIC_URL: 'https://api.standcast.app',
  SUPPORT_EMAIL: 'help@standcast.app',
  STANDCAST_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
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
    for (const raw of ['https://api.standcast.app/', 'https://api.standcast.app///']) {
      expect(parseEnv({ ...base, PUBLIC_URL: raw }).PUBLIC_URL).toBe('https://api.standcast.app');
    }
    expect(parseEnv({ ...base, PUBLIC_URL: 'https://x.dev/base/' }).PUBLIC_URL).toBe(
      'https://x.dev/base',
    );
    expect(parseEnv(base).PUBLIC_URL).toBe('https://api.standcast.app');
  });

  test('rejects a PUBLIC_URL that is not a url', () => {
    expect(() => parseEnv({ ...base, PUBLIC_URL: 'api.standcast.app' })).toThrow();
  });

  test('defaults DOCS_URL to the docs domain', () => {
    expect(parseEnv(base).DOCS_URL).toBe('https://docs.standcast.app');
  });

  test('accepts an https DOCS_URL without a trailing slash', () => {
    const DOCS_URL = 'https://docs-standcast.usefachada.dev';
    expect(parseEnv({ ...base, DOCS_URL }).DOCS_URL).toBe(DOCS_URL);
  });

  test('rejects a DOCS_URL that is not https, ends with a slash or is not a url', () => {
    for (const DOCS_URL of [
      'http://docs.standcast.app',
      'https://docs.standcast.app/',
      'docs.standcast.app',
      'javascript:alert(1)',
    ]) {
      expect(() => parseEnv({ ...base, DOCS_URL }), DOCS_URL).toThrow();
    }
  });

  test('defaults LANDING_URL and rejects http or a trailing slash', () => {
    expect(parseEnv(base).LANDING_URL).toBe('https://standcast.usefachada.dev');
    for (const LANDING_URL of ['http://x.dev', 'https://x.dev/', 'x.dev']) {
      expect(() => parseEnv({ ...base, LANDING_URL }), LANDING_URL).toThrow();
    }
  });
});
