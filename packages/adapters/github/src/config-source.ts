import type { Octokit } from '@octokit/core';
import { httpStatus } from './errors';

export type ConfigSource =
  | { found: true; source: string }
  | { found: false; reason: 'no_repo' | 'no_access' | 'no_file' };

const CONFIG_REPO = '.github';
const CONFIG_PATH = 'standcast.yml';

function failureReason(
  error: unknown,
  missing: 'no_repo' | 'no_file',
): 'no_repo' | 'no_access' | 'no_file' {
  const status = httpStatus(error);
  if (status === 404) return missing;
  if (status === 403) return 'no_access';
  throw error;
}

export async function fetchConfigSource(
  octokit: Octokit,
  owner: string,
  options: { ref?: string } = {},
): Promise<ConfigSource> {
  try {
    await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: CONFIG_REPO });
  } catch (error) {
    return { found: false, reason: failureReason(error, 'no_repo') };
  }
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo: CONFIG_REPO,
      path: CONFIG_PATH,
      ...(options.ref ? { ref: options.ref } : {}),
    });
    const data = response.data as { content?: string; encoding?: string };
    if (typeof data.content !== 'string') return { found: false, reason: 'no_file' };
    return { found: true, source: Buffer.from(data.content, 'base64').toString('utf8') };
  } catch (error) {
    return { found: false, reason: failureReason(error, 'no_file') };
  }
}
