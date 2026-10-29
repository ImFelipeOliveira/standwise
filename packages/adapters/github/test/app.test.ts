import { describe, expect, test } from 'bun:test';
import { createGitHubApp } from '../src/app';

describe('createGitHubApp', () => {
  test('builds an App with the given credentials', async () => {
    const app = createGitHubApp({
      appId: '1',
      privateKey: 'unused',
      webhookSecret: 'secret',
      clientId: 'Iv1.abc',
      clientSecret: 'shh',
    });
    expect(typeof app.getInstallationOctokit).toBe('function');
    expect(typeof app.webhooks.on).toBe('function');
  });
});
