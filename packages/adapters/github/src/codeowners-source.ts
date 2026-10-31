import type { Octokit } from '@octokit/core';
import { httpStatus } from './errors';

const PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

export async function fetchCodeowners(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<string | null> {
  for (const path of PATHS) {
    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{+path}', {
        owner,
        repo,
        path,
        ref,
        headers: { accept: 'application/vnd.github.raw+json' },
        request: { parseSuccessResponseBody: false },
      });
      return await new Response(response.data as BodyInit).text();
    } catch (error) {
      if (httpStatus(error) !== 404) throw error;
    }
  }
  return null;
}
