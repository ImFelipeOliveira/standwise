import type { Octokit } from '@octokit/core';

const MAX_ANNOTATIONS = 50;

export type CheckRunInput = {
  owner: string;
  repo: string;
  headSha: string;
  name: string;
  conclusion: 'success' | 'failure';
  title: string;
  summary: string;
  annotations: { path: string; line: number; message: string }[];
};

export async function createCheckRun(octokit: Octokit, input: CheckRunInput): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
    owner: input.owner,
    repo: input.repo,
    name: input.name,
    head_sha: input.headSha,
    status: 'completed',
    conclusion: input.conclusion,
    output: {
      title: input.title,
      summary: input.summary,
      annotations: input.annotations.slice(0, MAX_ANNOTATIONS).map((annotation) => ({
        path: annotation.path,
        start_line: annotation.line,
        end_line: annotation.line,
        annotation_level: 'failure' as const,
        message: annotation.message,
      })),
    },
  });
}
