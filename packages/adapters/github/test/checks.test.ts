import { describe, expect, test } from 'bun:test';
import { Octokit } from '@octokit/core';
import { createCheckRun } from '../src/checks';

function capturing() {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const octokit = new Octokit({
    request: {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request ? request.url : String(input));
        const raw = request ? await request.text() : String(init?.body);
        sent.push({
          method: (request?.method ?? init?.method ?? 'GET').toUpperCase(),
          path: url.pathname,
          body: JSON.parse(raw),
        });
        return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    },
  });
  return { octokit, sent };
}

const base = {
  owner: 'acme',
  repo: 'api',
  headSha: 'abc123',
  name: 'Standwise',
  title: 'Blocked',
  summary: 'Summary',
};

describe('createCheckRun', () => {
  test('sends the exact body', async () => {
    const { octokit, sent } = capturing();
    await createCheckRun(octokit, {
      ...base,
      conclusion: 'failure',
      annotations: [{ path: 'src/a.ts', line: 3, message: 'bad' }],
    });
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/repos/acme/api/check-runs',
        body: {
          name: 'Standwise',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'failure',
          output: {
            title: 'Blocked',
            summary: 'Summary',
            annotations: [
              {
                path: 'src/a.ts',
                start_line: 3,
                end_line: 3,
                annotation_level: 'failure',
                message: 'bad',
              },
            ],
          },
        },
      },
    ]);
  });

  test('truncates annotations to 50', async () => {
    const { octokit, sent } = capturing();
    await createCheckRun(octokit, {
      ...base,
      conclusion: 'success',
      annotations: Array.from({ length: 80 }, (_, i) => ({ path: `f${i}`, line: 1, message: 'm' })),
    });
    const body = sent[0]?.body as { output: { annotations: { path: string }[] } };
    expect(body.output.annotations).toHaveLength(50);
    expect(body.output.annotations[49]?.path).toBe('f49');
  });
});
