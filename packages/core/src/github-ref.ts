export type GitHubPullRef = { owner: string; repo: string; number: number };

const PULL_URL =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/;

export function parsePullRequestUrl(url: string): GitHubPullRef | null {
  const match = PULL_URL.exec(url.trim());
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { owner: match[1] as string, repo: match[2] as string, number };
}
