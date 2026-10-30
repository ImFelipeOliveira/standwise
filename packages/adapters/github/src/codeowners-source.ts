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
      });
      const data = response.data as { content?: string };
      if (typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
    } catch (error) {
      if (httpStatus(error) !== 404) throw error;
    }
  }
  return null;
}
