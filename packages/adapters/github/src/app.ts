import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';

export type GitHubEnv = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
};

export { App, Octokit };

export function createGitHubApp(env: GitHubEnv, opts: { fetch?: typeof fetch } = {}): App {
  const options = {
    appId: env.appId,
    privateKey: env.privateKey,
    webhooks: { secret: env.webhookSecret },
    oauth: { clientId: env.clientId, clientSecret: env.clientSecret },
  };
  if (!opts.fetch) return new App(options);
  return new App({ ...options, Octokit: Octokit.defaults({ request: { fetch: opts.fetch } }) });
}
